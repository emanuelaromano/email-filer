import { useCallback, useEffect, useState } from 'react'

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

type RuntimeResponse = {
  ok?: boolean
  error?: string
  projects?: unknown
}

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

  const refreshProjects = useCallback(async () => {
    if (!driveConnected) {
      setProjects([])
      return
    }
    const response = await sendRuntimeMessage<RuntimeResponse>({
      type: 'emailFilerGetProjectsTree',
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to load folders from Drive.')
    }
    setProjects(sanitizeTree(response.projects))
  }, [driveConnected])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProjects().catch(() => {
      setProjects([])
    })
  }, [refreshProjects])

  const addProject = useCallback(async (name: string, parentPath: string[] = []) => {
    const trimmed = name.trim()
    if (!trimmed) return false
    const response = await sendRuntimeMessage<RuntimeResponse>({
      type: 'emailFilerCreateFolder',
      parentPath,
      name: trimmed,
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to create folder.')
    }
    await refreshProjects()
    return true
  }, [refreshProjects])

  const renameProject = useCallback(async (path: string[], to: string) => {
    const nextName = to.trim()
    if (path.length === 0 || !nextName) return false
    const response = await sendRuntimeMessage<RuntimeResponse>({
      type: 'emailFilerRenameFolder',
      path,
      nextName,
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to rename folder.')
    }
    await refreshProjects()
    return true
  }, [refreshProjects])

  const deleteProject = useCallback(async (path: string[]) => {
    if (path.length === 0) return false
    const response = await sendRuntimeMessage<RuntimeResponse>({
      type: 'emailFilerDeleteFolder',
      path,
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to delete folder.')
    }
    await refreshProjects()
    return true
  }, [refreshProjects])

  return { projects, addProject, renameProject, deleteProject, refreshProjects }
}
