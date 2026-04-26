function defaultLocalState() {
  return { projects: [], snippetsByPath: {} }
}

function sanitizeProjectTree(input) {
  if (!Array.isArray(input)) return []
  const toNode = (value) => {
    if (!value || typeof value !== 'object') return null
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    if (!name) return null
    const children = Array.isArray(value.children)
      ? value.children.map(toNode).filter(Boolean)
      : []
    return { name, children }
  }
  return input.map(toNode).filter(Boolean)
}

function sanitizeSnippet(value) {
  if (!value || typeof value !== 'object') return null
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const link = typeof value.link === 'string' ? value.link.trim() : ''
  if (!text || !link) return null
  const id =
    typeof value.id === 'string' && value.id
      ? value.id
      : `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt
      ? value.createdAt
      : new Date().toISOString()
  return { id, text, link, createdAt }
}

function sanitizeSnippetsMap(input) {
  if (!input || typeof input !== 'object') return {}
  const output = {}
  for (const [key, maybeSnippets] of Object.entries(input)) {
    if (typeof key !== 'string') continue
    if (!Array.isArray(maybeSnippets)) continue
    output[key] = maybeSnippets.map(sanitizeSnippet).filter(Boolean)
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
    return Array.isArray(parsed)
      ? parsed.filter((segment) => typeof segment === 'string')
      : []
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
  scheduleLocalStateSync()
}

async function isLocalStateDirty() {
  const result = await chrome.storage.local.get([LOCAL_STATE_DIRTY_KEY])
  return Boolean(result[LOCAL_STATE_DIRTY_KEY])
}

async function markLocalStateClean() {
  await chrome.storage.local.set({ [LOCAL_STATE_DIRTY_KEY]: false })
}

async function setSyncStatus(status) {
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: status })
}
