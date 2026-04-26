const DRIVE_ROOT_FOLDER_NAME = 'Email Filer'
const DRIVE_CONNECTED_KEY = 'emailFilerDriveConnected'
const MAX_SNIPPET_TEXT_LENGTH = 10_000
const MAX_FOLDER_NAME_LENGTH = 255
const DRIVE_FOLDER_ID_KEY = 'emailFilerDriveFolderId'
const SYNC_STATUS_KEY = 'emailFilerSyncStatus'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const SNIPPET_MIME_TYPE = 'text/plain'
const LOCAL_STATE_KEY = 'emailFilerLocalState'
const LOCAL_STATE_DIRTY_KEY = 'emailFilerLocalStateDirty'
const LOCAL_STATE_REVISION_KEY = 'emailFilerLocalStateRevision'
const SYNC_INTERVAL_MS = 3_000

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!token) {
        reject(new Error('No token returned.'))
        return
      }
      resolve(token)
    })
  })
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve)
  })
}

function driveStatusMessage(status) {
  if (status === 401 || status === 403) return 'You don\u2019t have permission to access this file. Please reconnect Google Drive.'
  if (status === 404) return 'The file or folder was not found in Google Drive.'
  if (status === 429) return 'Too many requests to Google Drive. Please try again in a moment.'
  if (status >= 500) return 'Google Drive is temporarily unavailable. Please try again shortly.'
  return 'Something went wrong with Google Drive. Please try again.'
}

async function driveRequest(token, url, init = {}, retried = false) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  if (response.status === 401 && !retried) {
    await removeCachedAuthToken(token)
    const freshToken = await getAuthToken(false)
    return driveRequest(freshToken, url, init, true)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`Drive API error (${response.status}):`, detail)
    throw new Error(driveStatusMessage(response.status))
  }
  if (response.status === 204) return null
  if ((init.method ?? 'GET').toUpperCase() === 'DELETE') return null
  return response.json()
}

async function ensureEmailFilerFolder(token) {
  const query = encodeURIComponent(
    `name='${DRIVE_ROOT_FOLDER_NAME}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false and 'root' in parents`,
  )
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`
  const searchResult = await driveRequest(token, searchUrl)
  const existingId = searchResult?.files?.[0]?.id
  if (existingId) return existingId

  const createUrl = 'https://www.googleapis.com/drive/v3/files'
  const created = await driveRequest(token, createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_ROOT_FOLDER_NAME,
      mimeType: FOLDER_MIME_TYPE,
      parents: ['root'],
    }),
  })
  return created.id
}

function defaultLocalState() {
  return {
    projects: [],
    snippetsByPath: {},
  }
}

function sanitizeProjectTree(input) {
  if (!Array.isArray(input)) return []
  const toNode = (value) => {
    if (!value || typeof value !== 'object') return null
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!name) return null
    const children = Array.isArray(value.children) ? value.children.map(toNode).filter(Boolean) : []
    return { name, children }
  }
  return input.map(toNode).filter(Boolean)
}

function sanitizeSnippet(value) {
  if (!value || typeof value !== 'object') return null
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const link = typeof value.link === 'string' ? value.link.trim() : ''
  if (!text || !link) return null
  const id = typeof value.id === 'string' && value.id ? value.id : `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : new Date().toISOString()
  return { id, text, link, createdAt }
}

function sanitizeSnippetsMap(input) {
  if (!input || typeof input !== 'object') return {}
  const output = {}
  for (const [pathKey, maybeSnippets] of Object.entries(input)) {
    if (typeof pathKey !== 'string') continue
    if (!Array.isArray(maybeSnippets)) continue
    output[pathKey] = maybeSnippets.map(sanitizeSnippet).filter(Boolean)
  }
  return output
}

function sanitizeLocalState(input) {
  if (!input || typeof input !== 'object') return defaultLocalState()
  return {
    projects: sanitizeProjectTree(input.projects),
    snippetsByPath: sanitizeSnippetsMap(input.snippetsByPath),
  }
}

function pathKey(path) {
  return JSON.stringify(path)
}

function parsePathKey(key) {
  try {
    const parsed = JSON.parse(key)
    return Array.isArray(parsed) ? parsed.filter((segment) => typeof segment === 'string') : []
  } catch {
    return []
  }
}

function isPathPrefix(parent, fullPath) {
  if (parent.length > fullPath.length) return false
  return parent.every((segment, index) => segment === fullPath[index])
}

function cloneState(state) {
  return {
    projects: JSON.parse(JSON.stringify(state.projects)),
    snippetsByPath: JSON.parse(JSON.stringify(state.snippetsByPath)),
  }
}

function getNodeAtPath(nodes, path) {
  let currentNodes = nodes
  let currentNode = null
  for (const segment of path) {
    currentNode = currentNodes.find((node) => node.name === segment) ?? null
    if (!currentNode) return null
    currentNodes = currentNode.children
  }
  return currentNode
}

function renamePathPrefix(oldPrefix, newPrefix, snippetsByPath) {
  const updated = {}
  for (const [key, snippets] of Object.entries(snippetsByPath)) {
    const keyPath = parsePathKey(key)
    if (!isPathPrefix(oldPrefix, keyPath)) {
      updated[key] = snippets
      continue
    }
    const nextPath = [...newPrefix, ...keyPath.slice(oldPrefix.length)]
    updated[pathKey(nextPath)] = snippets
  }
  return updated
}

function removePathPrefix(prefix, snippetsByPath) {
  const updated = {}
  for (const [key, snippets] of Object.entries(snippetsByPath)) {
    const keyPath = parsePathKey(key)
    if (isPathPrefix(prefix, keyPath)) continue
    updated[key] = snippets
  }
  return updated
}

async function getLocalState() {
  const result = await chrome.storage.local.get([LOCAL_STATE_KEY])
  return sanitizeLocalState(result[LOCAL_STATE_KEY])
}

async function saveLocalState(state, markDirty = true) {
  await chrome.storage.local.set({
    [LOCAL_STATE_KEY]: sanitizeLocalState(state),
    ...(markDirty ? { [LOCAL_STATE_DIRTY_KEY]: true } : {}),
  })
}

async function getLocalStateRevision() {
  const result = await chrome.storage.local.get([LOCAL_STATE_REVISION_KEY])
  const revision = result[LOCAL_STATE_REVISION_KEY]
  return typeof revision === 'number' && Number.isFinite(revision) ? revision : 0
}

async function saveLocalMutation(state) {
  const revision = await getLocalStateRevision()
  await chrome.storage.local.set({
    [LOCAL_STATE_KEY]: sanitizeLocalState(state),
    [LOCAL_STATE_DIRTY_KEY]: true,
    [LOCAL_STATE_REVISION_KEY]: revision + 1,
    [SYNC_STATUS_KEY]: 'pending',
  })
}

async function isLocalStateDirty() {
  const result = await chrome.storage.local.get([LOCAL_STATE_DIRTY_KEY])
  return Boolean(result[LOCAL_STATE_DIRTY_KEY])
}

async function markLocalStateClean() {
  await chrome.storage.local.set({ [LOCAL_STATE_DIRTY_KEY]: false })
}

async function getFileText(token, fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Drive API error (${response.status}): ${text}`)
  }
  return response.text()
}

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function listChildFolders(token, parentId) {
  const query = encodeURIComponent(
    `'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME_TYPE}'`,
  )
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&orderBy=name_natural`
  const result = await driveRequest(token, url)
  return Array.isArray(result?.files) ? result.files : []
}

async function listChildItems(token, parentId) {
  const query = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,createdTime)&orderBy=name_natural`
  const result = await driveRequest(token, url)
  return Array.isArray(result?.files) ? result.files : []
}

async function findFolderByName(token, parentId, name) {
  const safeName = escapeDriveQueryValue(name)
  const query = encodeURIComponent(
    `'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME_TYPE}' and name='${safeName}'`,
  )
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`
  const result = await driveRequest(token, url)
  return result?.files?.[0] ?? null
}

async function createFolderInParent(token, parentId, name) {
  const created = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentId],
    }),
  })
  return created
}

function parseSnippetContent(content) {
  const lines = content.split('\n')
  const linkLine = lines[0] ?? ''
  if (!linkLine.startsWith('LINK:')) {
    return { link: '', text: content.trim() }
  }
  const link = linkLine.replace('LINK:', '').trim()
  const text = lines.slice(2).join('\n').trim()
  return { link, text }
}

function sanitizeFileNamePart(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim()
}

function snippetFileName(text) {
  const firstWords = text.split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
  const safe = sanitizeFileNamePart(firstWords) || 'snippet'
  return `${safe}-${Date.now()}.txt`
}

async function uploadSnippetFile(token, folderId, snippet) {
  const metadata = {
    name: snippetFileName(snippet.text),
    parents: [folderId],
    mimeType: SNIPPET_MIME_TYPE,
  }
  const boundary = 'email-filer-snippet-boundary'
  const payload =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/plain\r\n\r\n' +
    `LINK: ${snippet.link}\n\n${snippet.text}\r\n` +
    `--${boundary}--`
  const created = await driveRequest(
    token,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,createdTime',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: payload,
    },
  )
  return {
    id: snippet.id || created.id,
    text: snippet.text,
    link: snippet.link,
    createdAt: created.createdTime ?? snippet.createdAt ?? new Date().toISOString(),
  }
}

async function getRootFolderIdOrThrow() {
  const result = await chrome.storage.local.get([DRIVE_FOLDER_ID_KEY])
  const rootId = result[DRIVE_FOLDER_ID_KEY]
  if (!rootId || typeof rootId !== 'string') {
    throw new Error('Google Drive is not connected yet.')
  }
  return rootId
}

async function withToken(work) {
  const token = await getAuthToken(false).catch(() => null)
  if (!token) {
    await chrome.storage.local.set({ [DRIVE_CONNECTED_KEY]: false })
    throw new Error('Session expired. Please reconnect Google Drive.')
  }
  return work(token)
}

function respond(sendResponse, payload) {
  sendResponse(payload)
  return true
}

let syncInProgress = false

async function setSyncStatus(status) {
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: status })
}

async function hydrateFromDrive(token, rootFolderId) {
  const buildFolder = async (folderId, path = []) => {
    const items = await listChildItems(token, folderId)
    const folderItems = items
      .filter((item) => item.mimeType === FOLDER_MIME_TYPE)
      .sort((a, b) => a.name.localeCompare(b.name))
    const snippetItems = items
      .filter((item) => item.mimeType === SNIPPET_MIME_TYPE && item.name.endsWith('.txt'))
      .sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''))

    const snippets = await Promise.all(
      snippetItems.map(async (file) => {
        const content = await getFileText(token, file.id)
        const parsed = parseSnippetContent(content)
        return {
          id: file.id,
          text: parsed.text,
          link: parsed.link,
          createdAt: file.createdTime ?? new Date().toISOString(),
        }
      }),
    )

    const snippetsByPath = { [pathKey(path)]: snippets }
    const projects = []
    for (const folder of folderItems) {
      const child = await buildFolder(folder.id, [...path, folder.name])
      projects.push({ name: folder.name, children: child.projects })
      Object.assign(snippetsByPath, child.snippetsByPath)
    }
    return { projects, snippetsByPath }
  }

  const loaded = await buildFolder(rootFolderId, [])
  return sanitizeLocalState(loaded)
}

async function deleteDriveItem(token, itemId) {
  await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${itemId}`, {
    method: 'DELETE',
  })
}

async function moveItemToFolder(token, itemId, fromFolderId, toFolderId) {
  await driveRequest(
    token,
    `https://www.googleapis.com/drive/v3/files/${itemId}?addParents=${toFolderId}&removeParents=${fromFolderId}&fields=id`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
  )
}

async function pushStateToDriveAsFolders(token, rootFolderId, state) {
  const STAGING_NAME = '_staging_'
  const nextSnippetsByPath = {}

  const buildRecursive = async (parentId, nodes, path = []) => {
    const key = pathKey(path)
    const snippets = state.snippetsByPath[key] ?? []
    const uploaded = []
    for (const snippet of snippets) {
      if (!snippet.text || !snippet.link) continue
      const remoteSnippet = await uploadSnippetFile(token, parentId, snippet)
      uploaded.push(remoteSnippet)
    }
    nextSnippetsByPath[key] = uploaded

    for (const node of nodes) {
      const createdFolder = await createFolderInParent(token, parentId, node.name)
      await buildRecursive(createdFolder.id, node.children ?? [], [...path, node.name])
    }
  }

  // Phase 1: build into a staging folder — old data untouched if this fails
  const staging = await createFolderInParent(token, rootFolderId, STAGING_NAME)
  await buildRecursive(staging.id, state.projects, [])

  // Phase 2: swap — delete old children, move staging children to root
  const oldItems = await listChildItems(token, rootFolderId)
  for (const item of oldItems) {
    if (item.id !== staging.id) {
      await deleteDriveItem(token, item.id)
    }
  }
  const stagingChildren = await listChildItems(token, staging.id)
  for (const item of stagingChildren) {
    await moveItemToFolder(token, item.id, staging.id, rootFolderId)
  }
  await deleteDriveItem(token, staging.id)

  return { projects: state.projects, snippetsByPath: nextSnippetsByPath }
}

async function trySyncLocalStateToDrive() {
  if (syncInProgress) return
  syncInProgress = true
  try {
    const connectedResult = await chrome.storage.local.get([DRIVE_CONNECTED_KEY])
    if (!connectedResult[DRIVE_CONNECTED_KEY]) return
    const dirty = await isLocalStateDirty()
    if (!dirty) return
    const syncRevision = await getLocalStateRevision()
    await setSyncStatus('syncing')
    const state = await getLocalState()
    await withToken(async (token) => {
      const rootFolderId = await getRootFolderIdOrThrow()
      await pushStateToDriveAsFolders(token, rootFolderId, state)
      const latestRevision = await getLocalStateRevision()
      if (latestRevision === syncRevision) {
        await markLocalStateClean()
        await setSyncStatus('synced')
        return
      }
      await setSyncStatus('pending')
    })
  } catch {
    await setSyncStatus('error')
  } finally {
    syncInProgress = false
  }
}

void trySyncLocalStateToDrive()
setInterval(() => {
  void trySyncLocalStateToDrive()
}, SYNC_INTERVAL_MS)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return undefined

  if (message.type === 'emailFilerConnectDrive') {
    void (async () => {
      try {
        const accessToken = await getAuthToken(true)
        const driveFolderId = await ensureEmailFilerFolder(accessToken)
        const loadedState = await hydrateFromDrive(accessToken, driveFolderId)
        await chrome.storage.local.set({
          [DRIVE_CONNECTED_KEY]: true,
          [DRIVE_FOLDER_ID_KEY]: driveFolderId,
          [LOCAL_STATE_REVISION_KEY]: 0,
        })
        await saveLocalState(loadedState, false)
        await markLocalStateClean()
        await setSyncStatus('synced')
        sendResponse({ ok: true, driveFolderId })
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to connect Drive.',
        })
      }
    })()
    return true
  }

  if (message.type === 'emailFilerDisconnectDrive') {
    void (async () => {
      try {
        const token = await getAuthToken(false).catch(() => null)
        if (token) await removeCachedAuthToken(token)
        await chrome.storage.local.remove([
          DRIVE_CONNECTED_KEY,
          DRIVE_FOLDER_ID_KEY,
          LOCAL_STATE_KEY,
          LOCAL_STATE_DIRTY_KEY,
          LOCAL_STATE_REVISION_KEY,
          SYNC_STATUS_KEY,
        ])
        sendResponse({ ok: true })
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to disconnect Drive.',
        })
      }
    })()
    return true
  }

  if (message.type === 'emailFilerGetProjectsTree') {
    void getLocalState().then((state) => {
      sendResponse({ ok: true, projects: state.projects })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list local folders.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerCreateFolder') {
    const parentPath = Array.isArray(message.parentPath) ? message.parentPath : []
    const name = typeof message.name === 'string' ? message.name.trim() : ''
    if (!name) return respond(sendResponse, { ok: false, error: 'Folder name is required.' })
    if (name.length > MAX_FOLDER_NAME_LENGTH) {
      return respond(sendResponse, { ok: false, error: `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer.` })
    }

    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      const parentNode = parentPath.length === 0 ? null : getNodeAtPath(next.projects, parentPath)
      if (parentPath.length > 0 && !parentNode) {
        throw new Error('Parent folder no longer exists.')
      }
      const siblings = parentNode ? parentNode.children : next.projects
      let uniqueName = name
      if (siblings.some((node) => node.name === uniqueName)) {
        let counter = 1
        while (siblings.some((node) => node.name === `${name} (${counter})`)) {
          counter += 1
        }
        uniqueName = `${name} (${counter})`
      }
      siblings.push({ name: uniqueName, children: [] })
      await saveLocalMutation(next)
      sendResponse({ ok: true, name: uniqueName })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to create folder.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerRenameFolder') {
    const path = Array.isArray(message.path) ? message.path : []
    const nextName = typeof message.nextName === 'string' ? message.nextName.trim() : ''
    if (path.length === 0 || !nextName) {
      return respond(sendResponse, { ok: false, error: 'Folder path/name is required.' })
    }

    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      const parentPath = path.slice(0, -1)
      const currentName = path[path.length - 1]
      const parentNode = parentPath.length === 0 ? null : getNodeAtPath(next.projects, parentPath)
      const siblings = parentNode ? parentNode.children : next.projects
      const node = siblings.find((item) => item.name === currentName)
      if (!node) throw new Error('Folder no longer exists.')
      if (siblings.some((item) => item.name === nextName && item !== node)) {
        throw new Error(`A folder named "${nextName}" already exists here.`)
      }
      node.name = nextName

      const oldPath = path
      const newPath = [...parentPath, nextName]
      next.snippetsByPath = renamePathPrefix(oldPath, newPath, next.snippetsByPath)
      await saveLocalMutation(next)
      sendResponse({ ok: true })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to rename folder.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerDeleteFolder') {
    const path = Array.isArray(message.path) ? message.path : []
    if (path.length === 0) {
      return respond(sendResponse, { ok: false, error: 'Folder path is required.' })
    }
    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      const parentPath = path.slice(0, -1)
      const currentName = path[path.length - 1]
      const parentNode = parentPath.length === 0 ? null : getNodeAtPath(next.projects, parentPath)
      const siblings = parentNode ? parentNode.children : next.projects
      const idx = siblings.findIndex((item) => item.name === currentName)
      if (idx < 0) throw new Error('Folder no longer exists.')
      siblings.splice(idx, 1)
      next.snippetsByPath = removePathPrefix(path, next.snippetsByPath)
      await saveLocalMutation(next)
      sendResponse({ ok: true })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to delete folder.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerListSnippets') {
    const path = Array.isArray(message.path) ? message.path : []
    void getLocalState().then((state) => {
      const snippets = state.snippetsByPath[pathKey(path)] ?? []
      sendResponse({ ok: true, snippets })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list local snippets.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerSaveSnippet') {
    const path = Array.isArray(message.path) ? message.path : []
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    const link = typeof message.link === 'string' ? message.link.trim() : ''
    if (!text || !link) {
      return respond(sendResponse, { ok: false, error: 'Snippet text and link are required.' })
    }
    if (text.length > MAX_SNIPPET_TEXT_LENGTH) {
      return respond(sendResponse, { ok: false, error: `Snippet text must be ${MAX_SNIPPET_TEXT_LENGTH.toLocaleString()} characters or fewer.` })
    }
    try {
      const parsed = new URL(link)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return respond(sendResponse, { ok: false, error: 'Snippet link must be an http or https URL.' })
      }
    } catch {
      return respond(sendResponse, { ok: false, error: 'Snippet link is not a valid URL.' })
    }
    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      const key = pathKey(path)
      const created = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        text,
        link,
        createdAt: new Date().toISOString(),
      }
      next.snippetsByPath[key] = [created, ...(next.snippetsByPath[key] ?? [])]
      await saveLocalMutation(next)
      sendResponse({
        ok: true,
        snippet: created,
      })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to save snippet.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerDeleteSnippet') {
    const snippetId = typeof message.snippetId === 'string' ? message.snippetId : ''
    if (!snippetId) return respond(sendResponse, { ok: false, error: 'Snippet id is required.' })
    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      let removed = false
      for (const key of Object.keys(next.snippetsByPath)) {
        const before = next.snippetsByPath[key] ?? []
        const after = before.filter((item) => item.id !== snippetId)
        if (after.length !== before.length) {
          removed = true
          next.snippetsByPath[key] = after
        }
      }
      if (!removed) throw new Error('Snippet not found.')
      await saveLocalMutation(next)
      sendResponse({ ok: true })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to delete snippet.',
      })
    })
    return true
  }

  return undefined
})
