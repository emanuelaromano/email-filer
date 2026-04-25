import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

const STORAGE_KEY = 'emailFilerProjectNames'

export type ProjectNode = {
  name: string
  children: ProjectNode[]
}

function cloneNodes(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.map((node) => ({ name: node.name, children: cloneNodes(node.children) }))
}

function buildTreeFromLegacyPaths(paths: string[]): ProjectNode[] {
  const root: ProjectNode[] = []
  for (const rawPath of paths) {
    const parts = rawPath
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 0) continue

    let branch = root
    for (const part of parts) {
      let existing = branch.find((node) => node.name === part)
      if (!existing) {
        existing = { name: part, children: [] }
        branch.push(existing)
      }
      branch = existing.children
    }
  }
  return root
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

export function useExtensionProjects() {
  const [projects, setProjects] = useState<ProjectNode[]>([])

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const raw = result[STORAGE_KEY]
      if (Array.isArray(raw) && raw.every((value) => typeof value === 'string')) {
        const next = buildTreeFromLegacyPaths(raw as string[])
        setProjects(next)
        void chrome.storage.local.set({ [STORAGE_KEY]: next })
      } else {
        setProjects(sanitizeTree(raw))
      }
    })
  }, [])

  const addProject = useCallback((name: string, parentPath: string[] = []) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setProjects((prev) => {
      const next = addNodeAtPath(prev, parentPath, trimmed)
      if (next === prev) return prev
      void chrome.storage.local.set({ [STORAGE_KEY]: next })
      return next
    })
  }, [])

  const renameProject = useCallback((path: string[], to: string) => {
    const nextName = to.trim()
    if (path.length === 0 || !nextName) return false

    let renamed = false
    flushSync(() => {
      setProjects((prev) => {
        const next = renameNodeAtPath(prev, path, nextName)
        if (next === prev) return prev
        void chrome.storage.local.set({ [STORAGE_KEY]: next })
        renamed = true
        return next
      })
    })
    return renamed
  }, [])

  const deleteProject = useCallback((path: string[]) => {
    if (path.length === 0) return false
    let removed = false
    flushSync(() => {
      setProjects((prev) => {
        const next = deleteNodeAtPath(prev, path)
        if (next === prev) return prev
        void chrome.storage.local.set({ [STORAGE_KEY]: next })
        removed = true
        return next
      })
    })
    return removed
  }, [])

  return { projects, addProject, renameProject, deleteProject }
}
