const DRIVE_ROOT_FOLDER_NAME = 'Email Filer'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const OAUTH_CLIENT_ID = '983812666197-3dghs41umumv5t527bcehesne233q932.apps.googleusercontent.com'
const DRIVE_CONNECTED_KEY = 'emailFilerDriveConnected'
const DRIVE_FOLDER_ID_KEY = 'emailFilerDriveFolderId'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const SNIPPET_MIME_TYPE = 'text/plain'

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

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
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

async function resolveFolderPath(token, path) {
  let parentId = await getRootFolderIdOrThrow()
  for (const segment of path) {
    const next = await findFolderByName(token, parentId, segment)
    if (!next?.id) return null
    parentId = next.id
  }
  return parentId
}

async function listChildFolders(token, parentId) {
  const query = encodeURIComponent(
    `'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME_TYPE}'`,
  )
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&orderBy=name_natural`
  const result = await driveRequest(token, url)
  return Array.isArray(result?.files) ? result.files : []
}

async function buildTree(token, parentId) {
  const folders = await listChildFolders(token, parentId)
  const nodes = await Promise.all(
    folders.map(async (folder) => ({
      name: folder.name,
      children: await buildTree(token, folder.id),
    })),
  )
  return nodes
}

async function createFolderInParent(token, parentId, name) {
  const existing = await findFolderByName(token, parentId, name)
  if (existing?.id) {
    throw new Error(`A folder named "${name}" already exists here.`)
  }
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

async function listSnippetFiles(token, folderId) {
  const query = encodeURIComponent(
    `'${folderId}' in parents and trashed=false and mimeType='${SNIPPET_MIME_TYPE}' and name contains '.txt'`,
  )
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,createdTime)&orderBy=createdTime desc`
  const result = await driveRequest(token, url)
  return Array.isArray(result?.files) ? result.files : []
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

function respond(sendResponse, payload) {
  sendResponse(payload)
  return true
}

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
          await setStoredDriveToken(accessToken)
          await chrome.storage.local.set({
            [DRIVE_CONNECTED_KEY]: true,
            [DRIVE_FOLDER_ID_KEY]: driveFolderId,
          })

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
    void withToken(async (token) => {
      const rootId = await getRootFolderIdOrThrow()
      const projects = await buildTree(token, rootId)
      sendResponse({ ok: true, projects })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list Drive folders.',
      })
    })
    return true
  }

  if (message.type === 'emailFilerCreateFolder') {
    const parentPath = Array.isArray(message.parentPath) ? message.parentPath : []
    const name = typeof message.name === 'string' ? message.name.trim() : ''
    if (!name) return respond(sendResponse, { ok: false, error: 'Folder name is required.' })

    void withToken(async (token) => {
      const parentFolderId =
        parentPath.length === 0
          ? await getRootFolderIdOrThrow()
          : await resolveFolderPath(token, parentPath)
      if (!parentFolderId) {
        throw new Error('Parent folder no longer exists in Drive.')
      }

      await createFolderInParent(token, parentFolderId, name)
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

    void withToken(async (token) => {
      const folderId = await resolveFolderPath(token, path)
      if (!folderId) throw new Error('Folder no longer exists in Drive.')
      const parentId =
        path.length === 1
          ? await getRootFolderIdOrThrow()
          : await resolveFolderPath(token, path.slice(0, -1))
      if (!parentId) throw new Error('Parent folder no longer exists in Drive.')

      const duplicate = await findFolderByName(token, parentId, nextName)
      if (duplicate?.id && duplicate.id !== folderId) {
        throw new Error(`A folder named "${nextName}" already exists here.`)
      }

      await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      })
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
    void withToken(async (token) => {
      const folderId = await resolveFolderPath(token, path)
      if (!folderId) throw new Error('Folder no longer exists in Drive.')
      await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${folderId}`, {
        method: 'DELETE',
      })
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
    void withToken(async (token) => {
      const folderId =
        path.length === 0 ? await getRootFolderIdOrThrow() : await resolveFolderPath(token, path)
      if (!folderId) throw new Error('Folder no longer exists in Drive.')
      const files = await listSnippetFiles(token, folderId)
      const snippets = await Promise.all(
        files.map(async (file) => {
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
      sendResponse({ ok: true, snippets })
    }).catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list snippets.',
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
    void withToken(async (token) => {
      const folderId =
        path.length === 0 ? await getRootFolderIdOrThrow() : await resolveFolderPath(token, path)
      if (!folderId) throw new Error('Target folder no longer exists in Drive.')

      const metadata = {
        name: snippetFileName(text),
        parents: [folderId],
        mimeType: SNIPPET_MIME_TYPE,
      }
      const boundary = 'email-filer-boundary'
      const payload =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        'Content-Type: text/plain\r\n\r\n' +
        `LINK: ${link}\n\n${text}\r\n` +
        `--${boundary}--`
      const created = await driveRequest(
        token,
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime',
        {
          method: 'POST',
          headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: payload,
        },
      )
      sendResponse({
        ok: true,
        snippet: {
          id: created.id,
          text,
          link,
          createdAt: created.createdTime ?? new Date().toISOString(),
        },
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
    void withToken(async (token) => {
      await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${snippetId}`, {
        method: 'DELETE',
      })
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
