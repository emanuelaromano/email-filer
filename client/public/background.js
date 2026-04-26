const DRIVE_ROOT_FOLDER_NAME = 'Email Filer'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const OAUTH_CLIENT_ID = '983812666197-3dghs41umumv5t527bcehesne233q932.apps.googleusercontent.com'
const DRIVE_CONNECTED_KEY = 'emailFilerDriveConnected'
const DRIVE_FOLDER_ID_KEY = 'emailFilerDriveFolderId'
const SYNC_STATUS_KEY = 'emailFilerSyncStatus'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const SNIPPET_MIME_TYPE = 'text/plain'
const LOCAL_STATE_KEY = 'emailFilerLocalState'
const LOCAL_STATE_DIRTY_KEY = 'emailFilerLocalStateDirty'
const SYNC_INTERVAL_MS = 5_000

function buildAuthUrl() {
  const redirectUri = chrome.identity.getRedirectURL('oauth2')
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: DRIVE_SCOPE,
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

function parseAccessTokenFromRedirect(redirectUrl) {
  const hash = redirectUrl.split('#')[1]
  if (!hash) return null
  const fragmentParams = new URLSearchParams(hash)
  return fragmentParams.get('access_token')
}

async function driveRequest(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Drive API error (${response.status}): ${text}`)
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
    id: created.id,
    text: snippet.text,
    link: snippet.link,
    createdAt: created.createdTime ?? snippet.createdAt ?? new Date().toISOString(),
  }
}

async function getStoredDriveToken() {
  const result = await chrome.storage.local.get(['emailFilerDriveAccessToken'])
  const token = result.emailFilerDriveAccessToken
  return typeof token === 'string' && token ? token : null
}

async function setStoredDriveToken(token) {
  await chrome.storage.local.set({ emailFilerDriveAccessToken: token })
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
  const token = await getStoredDriveToken()
  if (!token) {
    await chrome.storage.local.set({
      [DRIVE_CONNECTED_KEY]: false,
    })
    throw new Error('Missing Drive token. Please reconnect Google Drive.')
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

async function clearDriveFolder(token, folderId) {
  const items = await listChildItems(token, folderId)
  for (const item of items) {
    await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${item.id}`, {
      method: 'DELETE',
    })
  }
}

async function pushStateToDriveAsFolders(token, rootFolderId, state) {
  await clearDriveFolder(token, rootFolderId)
  const nextSnippetsByPath = {}

  const createRecursive = async (parentId, nodes, path = []) => {
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
      await createRecursive(createdFolder.id, node.children ?? [], [...path, node.name])
    }
  }

  await createRecursive(rootFolderId, state.projects, [])
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
    await setSyncStatus('syncing')
    const state = await getLocalState()
    await withToken(async (token) => {
      const rootFolderId = await getRootFolderIdOrThrow()
      const syncedState = await pushStateToDriveAsFolders(token, rootFolderId, state)
      await saveLocalState(syncedState, false)
      await markLocalStateClean()
    })
    await setSyncStatus('synced')
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
    if (OAUTH_CLIENT_ID === 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID') {
      return respond(sendResponse, {
        ok: false,
        error:
          'Google OAuth client ID is missing. Set OAUTH_CLIENT_ID in public/background.js first.',
      })
    }

    chrome.identity.launchWebAuthFlow(
      {
        url: buildAuthUrl(),
        interactive: true,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message ?? 'Google sign-in was cancelled.',
          })
          return
        }

        if (!redirectUrl) {
          sendResponse({ ok: false, error: 'No OAuth redirect URL was returned.' })
          return
        }

        try {
          const accessToken = parseAccessTokenFromRedirect(redirectUrl)
          if (!accessToken) {
            throw new Error('No access token was found in the OAuth callback.')
          }

          const driveFolderId = await ensureEmailFilerFolder(accessToken)
          const loadedState = await hydrateFromDrive(accessToken, driveFolderId)
          await setStoredDriveToken(accessToken)
          await chrome.storage.local.set({
            [DRIVE_CONNECTED_KEY]: true,
            [DRIVE_FOLDER_ID_KEY]: driveFolderId,
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
      },
    )

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

    void getLocalState().then(async (state) => {
      const next = cloneState(state)
      const parentNode = parentPath.length === 0 ? null : getNodeAtPath(next.projects, parentPath)
      if (parentPath.length > 0 && !parentNode) {
        throw new Error('Parent folder no longer exists.')
      }
      const siblings = parentNode ? parentNode.children : next.projects
      if (siblings.some((node) => node.name === name)) {
        throw new Error(`A folder named "${name}" already exists here.`)
      }
      siblings.push({ name, children: [] })
      await saveLocalState(next, true)
      await setSyncStatus('pending')
      sendResponse({ ok: true })
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
      await saveLocalState(next, true)
      await setSyncStatus('pending')
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
      await saveLocalState(next, true)
      await setSyncStatus('pending')
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
      await saveLocalState(next, true)
      await setSyncStatus('pending')
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
      await saveLocalState(next, true)
      await setSyncStatus('pending')
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
