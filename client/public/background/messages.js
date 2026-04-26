function respond(sendResponse, payload) {
  sendResponse(payload)
  return true
}

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
        if (debounceSyncTimeout !== null) {
          clearTimeout(debounceSyncTimeout)
          debounceSyncTimeout = null
        }
        await chrome.alarms.clear(SYNC_ALARM_NAME)
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
