function driveStatusMessage(status) {
  if (status === 401 || status === 403)
    return 'You don\u2019t have permission to access this file. Please reconnect Google Drive.'
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

  const created = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files', {
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

async function getFileText(token, fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Drive API error (${response.status}): ${text}`)
  }
  return response.text()
}

async function listChildItems(token, parentId) {
  const query = encodeURIComponent(`'${parentId}' in parents and trashed=false`)
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,mimeType,createdTime)&orderBy=name_natural`
  const result = await driveRequest(token, url)
  return Array.isArray(result?.files) ? result.files : []
}

async function createFolderInParent(token, parentId, name) {
  return driveRequest(token, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, parents: [parentId] }),
  })
}

function parseSnippetContent(content) {
  const lines = content.split('\n')
  const linkLine = lines[0] ?? ''
  if (!linkLine.startsWith('LINK:')) return { link: '', text: content.trim() }
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

function isDriveFileId(id) {
  return typeof id === 'string' && id.length >= 20 && !id.startsWith('local-') && !id.startsWith('snippet-')
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

// Silently ignores errors (e.g. item already removed as part of a parent folder deletion).
async function tryDeleteDriveItem(token, itemId) {
  try {
    await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${itemId}`, {
      method: 'DELETE',
    })
  } catch {
    // ignore
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

async function hydrateFromDrive(token, rootFolderId) {
  const folderMap = {}

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

    const childResults = await Promise.all(
      folderItems.map(async (folder) => {
        const childPath = [...path, folder.name]
        folderMap[pathKey(childPath)] = folder.id
        const child = await buildFolder(folder.id, childPath)
        return { name: folder.name, children: child.projects, snippetsByPath: child.snippetsByPath }
      }),
    )

    const snippetsByPath = { [pathKey(path)]: snippets }
    for (const child of childResults) {
      Object.assign(snippetsByPath, child.snippetsByPath)
    }

    return {
      projects: childResults.map(({ name, children }) => ({ name, children })),
      snippetsByPath,
    }
  }

  const loaded = await buildFolder(rootFolderId, [])
  const state = sanitizeLocalState(loaded)

  await chrome.storage.local.set({
    [DRIVE_FOLDER_MAP_KEY]: folderMap,
    [DRIVE_SYNCED_STATE_KEY]: state,
  })

  return state
}

async function pushStateToDriveAsFolders(token, rootFolderId, state) {
  const cached = await chrome.storage.local.get([DRIVE_FOLDER_MAP_KEY, DRIVE_SYNCED_STATE_KEY])
  const folderMap = { ...(cached[DRIVE_FOLDER_MAP_KEY] ?? {}) }
  const lastSynced = cached[DRIVE_SYNCED_STATE_KEY] ?? null

  // Collect the Drive file IDs that still exist in local state.
  const localDriveIds = new Set()
  for (const snippets of Object.values(state.snippetsByPath)) {
    for (const snippet of snippets) {
      if (isDriveFileId(snippet.id)) localDriveIds.add(snippet.id)
    }
  }

  // Compute the set of active folder paths from the current project tree.
  const activeFolderPaths = new Set([pathKey([])])
  const collectPaths = (nodes, path) => {
    for (const node of nodes) {
      const childPath = [...path, node.name]
      activeFolderPaths.add(pathKey(childPath))
      collectPaths(node.children ?? [], childPath)
    }
  }
  collectPaths(state.projects, [])

  // Delete Drive folders that are no longer in the project tree.
  const staleFolderKeys = Object.keys(folderMap).filter((k) => !activeFolderPaths.has(k))
  const staleFolderPaths = staleFolderKeys.map(parsePathKey)
  await Promise.all(
    staleFolderKeys.map(async (k) => {
      await tryDeleteDriveItem(token, folderMap[k])
      delete folderMap[k]
    }),
  )

  const invalidatedDriveIds = new Set()
  if (lastSynced) {
    const deletions = []
    for (const [key, snippets] of Object.entries(lastSynced.snippetsByPath)) {
      const keyPath = parsePathKey(key)
      const inDeletedFolder = staleFolderPaths.some((sp) => isPathPrefix(sp, keyPath))
      for (const snippet of snippets) {
        if (!isDriveFileId(snippet.id)) continue
        if (inDeletedFolder) {
          invalidatedDriveIds.add(snippet.id)
        } else if (!localDriveIds.has(snippet.id)) {
          deletions.push(snippet.id)
        }
      }
    }
    await Promise.all(deletions.map((id) => tryDeleteDriveItem(token, id)))
  }
  if (!lastSynced) {
    const existingItems = await listChildItems(token, rootFolderId)
    await Promise.all(existingItems.map((item) => tryDeleteDriveItem(token, item.id)))
    for (const k of Object.keys(folderMap)) delete folderMap[k]
  }

  // Ensure all folders exist in Drive. For folders already in the map, verify they
  // are still alive with a cheap metadata GET; if gone, invalidate and recreate.
  const ensureFolders = async (nodes, path, parentId) => {
    await Promise.all(
      nodes.map(async (node) => {
        const childPath = [...path, node.name]
        const key = pathKey(childPath)
        if (folderMap[key]) {
          const meta = await driveRequest(
            token,
            `https://www.googleapis.com/drive/v3/files/${folderMap[key]}?fields=id,trashed`,
          ).catch(() => null)
          if (!meta || meta.trashed) delete folderMap[key]
        }
        if (!folderMap[key]) {
          const created = await createFolderInParent(token, parentId, node.name)
          folderMap[key] = created.id
        }
        await ensureFolders(node.children ?? [], childPath, folderMap[key])
      }),
    )
  }
  await ensureFolders(state.projects, [], rootFolderId)

  // List the actual snippet file IDs present in each Drive folder. Any snippet whose
  // Drive ID is absent from Drive has been deleted externally and must be re-uploaded.
  const existingDriveFileIds = new Set()
  await Promise.all(
    [...activeFolderPaths].map(async (key) => {
      const parsedPath = parsePathKey(key)
      const folderId = parsedPath.length === 0 ? rootFolderId : folderMap[key]
      if (!folderId) return
      const items = await listChildItems(token, folderId)
      for (const item of items) {
        if (item.mimeType === SNIPPET_MIME_TYPE) existingDriveFileIds.add(item.id)
      }
    }),
  )

  const nextSnippetsByPath = {}
  await Promise.all(
    Object.entries(state.snippetsByPath).map(async ([key, snippets]) => {
      const parsedPath = parsePathKey(key)
      const folderId = parsedPath.length === 0 ? rootFolderId : folderMap[key]
      if (!folderId) {
        nextSnippetsByPath[key] = snippets
        return
      }
      nextSnippetsByPath[key] = await Promise.all(
        snippets
          .filter((s) => s.text && s.link)
          .map((snippet) => {
            if (
              isDriveFileId(snippet.id) &&
              !invalidatedDriveIds.has(snippet.id) &&
              existingDriveFileIds.has(snippet.id)
            ) return snippet
            return uploadSnippetFile(token, folderId, snippet)
          }),
      )
    }),
  )

  const nextState = { projects: state.projects, snippetsByPath: nextSnippetsByPath }

  await chrome.storage.local.set({
    [DRIVE_FOLDER_MAP_KEY]: folderMap,
    [DRIVE_SYNCED_STATE_KEY]: nextState,
  })

  return nextState
}
