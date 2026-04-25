import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'emailFilerProjectNames'

export function useExtensionProjects() {
  const [projects, setProjects] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const raw = result[STORAGE_KEY]
      setProjects(Array.isArray(raw) ? (raw as string[]).filter(Boolean) : [])
      setHydrated(true)
    })
  }, [])

  const addProject = useCallback((name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setProjects((prev) => {
      if (prev.includes(trimmed)) return prev
      const next = [...prev, trimmed]
      void chrome.storage.local.set({ [STORAGE_KEY]: next })
      return next
    })
  }, [])

  const renameProject = useCallback((from: string, to: string) => {
    const nextName = to.trim()
    if (!from || !nextName) return false

    let renamed = false
    setProjects((prev) => {
      if (!prev.includes(from) || prev.includes(nextName)) return prev
      const next = prev.map((name) => (name === from ? nextName : name))
      void chrome.storage.local.set({ [STORAGE_KEY]: next })
      renamed = true
      return next
    })
    return renamed
  }, [])

  const deleteProject = useCallback((name: string) => {
    let removed = false
    setProjects((prev) => {
      if (!prev.includes(name)) return prev
      const next = prev.filter((project) => project !== name)
      void chrome.storage.local.set({ [STORAGE_KEY]: next })
      removed = true
      return next
    })
    return removed
  }, [])

  return { projects, addProject, renameProject, deleteProject, hydrated }
}
