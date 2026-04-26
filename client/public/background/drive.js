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

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
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
