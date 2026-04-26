import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type ProjectNode = {
  name: string
  children: ProjectNode[]
}

function sanitizeTree(input: unknown): ProjectNode[] {
  if (!Array.isArray(input)) return []
  const toNode = (value: unknown): ProjectNode | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { name?: unknown; children?: unknown }
    if (typeof candidate.name !== 'string') return null
    const trimmed = candidate.name.trim()
    if (!trimmed) return null
    const children = Array.isArray(candidate.children)
      ? candidate.children.map(toNode).filter(Boolean) as ProjectNode[]
      : []
    return { name: trimmed, children }
  }
  return input.map(toNode).filter(Boolean) as ProjectNode[]
}

function cloneNodes(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.map((node) => ({ name: node.name, children: cloneNodes(node.children) }))
}

export function getNodeAtPath(nodes: ProjectNode[], path: string[]): ProjectNode | null {
  let currentNodes = nodes
  let current: ProjectNode | null = null
  for (const segment of path) {
    current = currentNodes.find((node) => node.name === segment) ?? null
    if (!current) return null
    currentNodes = current.children
  }
  return current
}

function addNodeAtPath(nodes: ProjectNode[], parentPath: string[], name: string): ProjectNode[] {
  const next = cloneNodes(nodes)
  const parent = parentPath.length === 0 ? null : getNodeAtPath(next, parentPath)
  const siblings = parent ? parent.children : next
  if (siblings.some((node) => node.name === name)) return nodes
  siblings.push({ name, children: [] })
  return next
}

function renameNodeAtPath(nodes: ProjectNode[], path: string[], nextName: string): ProjectNode[] {
  if (path.length === 0) return nodes
  const next = cloneNodes(nodes)
  const parentPath = path.slice(0, -1)
  const currentName = path[path.length - 1]
  const siblings =
    parentPath.length === 0 ? next : (getNodeAtPath(next, parentPath)?.children ?? null)
  if (!siblings) return nodes
  const target = siblings.find((node) => node.name === currentName)
  if (!target) return nodes
  if (siblings.some((node) => node !== target && node.name === nextName)) return nodes
  target.name = nextName
  return next
}

function deleteNodeAtPath(nodes: ProjectNode[], path: string[]): ProjectNode[] {
  if (path.length === 0) return nodes
  const next = cloneNodes(nodes)
  const parentPath = path.slice(0, -1)
  const currentName = path[path.length - 1]
  const siblings =
    parentPath.length === 0 ? next : (getNodeAtPath(next, parentPath)?.children ?? null)
  if (!siblings) return nodes
  const index = siblings.findIndex((node) => node.name === currentName)
  if (index < 0) return nodes
  siblings.splice(index, 1)
  return next
}

type RuntimeResponse = {
  ok?: boolean
  error?: string
  projects?: unknown
}

type ProjectOp =
  | { type: 'create'; parentPath: string[]; name: string }
  | { type: 'rename'; path: string[]; nextName: string }
  | { type: 'delete'; path: string[] }

function sendRuntimeMessage<T = RuntimeResponse>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response as T)
    })
  })
}

export function useExtensionProjects(driveConnected: boolean) {
  const [projects, setProjects] = useState<ProjectNode[]>([])
  const [hasPendingSync, setHasPendingSync] = useState(false)
  const [lastSyncError, setLastSyncError] = useState<string | null>(null)
  const queueRef = useRef<ProjectOp[]>([])
  const flushingRef = useRef(false)

  const refreshProjects = useCallback(async () => {
    if (!driveConnected) return
    const response = await sendRuntimeMessage<RuntimeResponse>({
      type: 'emailFilerGetProjectsTree',
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to load folders from Drive.')
    }
    setProjects(sanitizeTree(response.projects))
  }, [driveConnected])

  useEffect(() => {
    if (!driveConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjects([])
      queueRef.current = []
      setHasPendingSync(false)
      setLastSyncError(null)
      return
    }
    void refreshProjects().catch(() => {
      setProjects([])
    })
  }, [driveConnected, refreshProjects])

  const flushProjectOps = useCallback(async () => {
    if (!driveConnected) return
    if (flushingRef.current) return
    if (queueRef.current.length === 0) return
    flushingRef.current = true
    const batch = queueRef.current.splice(0, queueRef.current.length)
    try {
      for (let index = 0; index < batch.length; index += 1) {
        const op = batch[index]
        const message =
          op.type === 'create'
            ? { type: 'emailFilerCreateFolder', parentPath: op.parentPath, name: op.name }
            : op.type === 'rename'
              ? { type: 'emailFilerRenameFolder', path: op.path, nextName: op.nextName }
              : { type: 'emailFilerDeleteFolder', path: op.path }
        const response = await sendRuntimeMessage<RuntimeResponse>(message)
        if (!response?.ok) {
          const remaining = batch.slice(index)
          queueRef.current = [...remaining, ...queueRef.current]
          setLastSyncError(response?.error ?? 'Failed to sync folders to Drive.')
          setHasPendingSync(true)
          return
        }
      }
      setLastSyncError(null)
      setHasPendingSync(queueRef.current.length > 0)
    } finally {
      flushingRef.current = false
    }
  }, [driveConnected])

  useEffect(() => {
    if (!driveConnected) return
    const timer = window.setInterval(() => {
      void flushProjectOps()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [driveConnected, flushProjectOps])

  const enqueue = useCallback((op: ProjectOp) => {
    queueRef.current.push(op)
    setHasPendingSync(true)
  }, [])

  const addProject = useCallback((name: string, parentPath: string[] = []) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    let added = false
    setProjects((prev) => {
      const next = addNodeAtPath(prev, parentPath, trimmed)
      added = next !== prev
      return next
    })
    if (!added) return false
    enqueue({ type: 'create', parentPath: [...parentPath], name: trimmed })
    return true
  }, [enqueue])

  const renameProject = useCallback((path: string[], to: string) => {
    const nextName = to.trim()
    if (path.length === 0 || !nextName) return false
    let renamed = false
    setProjects((prev) => {
      const next = renameNodeAtPath(prev, path, nextName)
      renamed = next !== prev
      return next
    })
    if (!renamed) return false
    enqueue({ type: 'rename', path: [...path], nextName })
    return true
  }, [enqueue])

  const deleteProject = useCallback((path: string[]) => {
    if (path.length === 0) return false
    let removed = false
    setProjects((prev) => {
      const next = deleteNodeAtPath(prev, path)
      removed = next !== prev
      return next
    })
    if (!removed) return false
    enqueue({ type: 'delete', path: [...path] })
    return true
  }, [enqueue])

  return useMemo(
    () => ({
      projects,
      addProject,
      renameProject,
      deleteProject,
      refreshProjects,
      hasPendingSync,
      lastSyncError,
      flushProjectOps,
    }),
    [
      projects,
      addProject,
      renameProject,
      deleteProject,
      refreshProjects,
      hasPendingSync,
      lastSyncError,
      flushProjectOps,
    ],
  )
}
