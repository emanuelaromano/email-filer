import { useEffect, useMemo, useState } from 'react'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import Box from '@mui/material/Box'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import FolderButton from './components/FolderButton'
import ProjectInlineForm from './components/ProjectInlineForm'
import ProjectRenameInlineForm from './components/ProjectRenameInlineForm'
import ProjectsToolbar from './components/ProjectsToolbar'
import SavedSnippetsList from './components/SavedSnippetsList'
import SidebarHeader from './components/SidebarHeader'
import Toast from './components/Toast'
import { PENDING_HIGHLIGHT_KEY } from './storageKeys'
import { applyHighlightToSnippet } from './utils/highlightSnippet'
import { registerSaveShortcut } from './utils/shortcuts'
import { getNodeAtPath, useExtensionProjects } from './useExtensionProjects'

const SIDEBAR_WIDTH = 320
const SIDEBAR_WIDTH_COLLAPSED = 48
const SAVED_ITEMS_KEY = 'emailFilerProjectSavedItems'
const ROOT_SNIPPETS_KEY = '__root__'
const ROOT_SNIPPETS_LABEL = 'Library'

type SavedItem = {
  id: string
  text: string
  link: string
  createdAt: string
}

type SaveResult = {
  ok: boolean
  message: string
}

type PendingHighlight = {
  text: string
  createdAt: number
}

type ProjectPath = string[]

function isSamePath(left: ProjectPath | null, right: ProjectPath | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((part, index) => part === right[index])
}

function getProjectStorageKey(path: ProjectPath): string {
  return JSON.stringify(path)
}

export default function SidebarApp() {
  const [collapsed, setCollapsed] = useState(false)
  const { projects, addProject, renameProject, deleteProject } = useExtensionProjects()
  const [selectedPath, setSelectedPath] = useState<ProjectPath | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameFromPath, setRenameFromPath] = useState<ProjectPath | null>(null)
  const [renameName, setRenameName] = useState('')
  const [menuProjectPath, setMenuProjectPath] = useState<ProjectPath | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [snippetMenuItemId, setSnippetMenuItemId] = useState<string | null>(null)
  const [snippetMenuStorageKey, setSnippetMenuStorageKey] = useState<string | null>(null)
  const [snippetMenuPos, setSnippetMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [savedItemsByProject, setSavedItemsByProject] = useState<
    Record<string, SavedItem[]>
  >({})
  const [openedProjectPath, setOpenedProjectPath] = useState<ProjectPath | null>(null)

  const openedProjectNode = useMemo(
    () => (openedProjectPath ? getNodeAtPath(projects, openedProjectPath) : null),
    [projects, openedProjectPath],
  )
  const isOpenedView = openedProjectPath !== null
  const rootProjects = projects
  const openedProjectChildren = openedProjectNode?.children ?? []

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH
  const rootSnippetsItems = savedItemsByProject[ROOT_SNIPPETS_KEY] ?? []
  const openedProjectItems = openedProjectPath
    ? (savedItemsByProject[getProjectStorageKey(openedProjectPath)] ?? [])
    : []
  const openedProjectLabel = openedProjectPath?.join(' - ') ?? ''

  /**
   * Save shortcut target: open folder if any, otherwise root library (Finder-style window,
   * not the selected row highlight).
   */
  const saveShortcutTarget = useMemo(() => {
    if (openedProjectPath) {
      return {
        projectKey: getProjectStorageKey(openedProjectPath),
        projectLabel: openedProjectLabel,
      }
    }
    return { projectKey: ROOT_SNIPPETS_KEY, projectLabel: ROOT_SNIPPETS_LABEL }
  }, [openedProjectPath, openedProjectLabel])

  const handleDeleteSavedSnippet = (snippetId: string, projectKey: string) => {
    chrome.storage.local.get([SAVED_ITEMS_KEY], (result) => {
      const byProject =
        (result[SAVED_ITEMS_KEY] as Record<string, SavedItem[]>) ?? {}
      const existing = Array.isArray(byProject[projectKey]) ? byProject[projectKey] : []
      const nextItems = existing.filter((item) => item.id !== snippetId)
      const next = {
        ...byProject,
        [projectKey]: nextItems,
      }

      setSavedItemsByProject(next)
      void chrome.storage.local.set({ [SAVED_ITEMS_KEY]: next })
      setSaveStatus('Snippet deleted.')
    })
  }

  const saveHighlightedSelection = (
    projectKey: string,
    projectLabel: string,
  ): SaveResult => {
    const selection = window.getSelection()?.toString() ?? ''
    if (!selection.trim()) {
      return { ok: false, message: 'Highlight text in an email first.' }
    }

    const link = window.location.href
    const item: SavedItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: selection,
      link,
      createdAt: new Date().toISOString(),
    }

    chrome.storage.local.get([SAVED_ITEMS_KEY], (result) => {
      const byProject =
        (result[SAVED_ITEMS_KEY] as Record<string, SavedItem[]>) ?? {}
      const existing = Array.isArray(byProject[projectKey])
        ? byProject[projectKey]
        : []
      const next = {
        ...byProject,
        [projectKey]: [item, ...existing],
      }
      setSavedItemsByProject(next)
      void chrome.storage.local.set({ [SAVED_ITEMS_KEY]: next })
    })

    return { ok: true, message: `Saved to ${projectLabel}.` }
  }

  useEffect(() => {
    chrome.storage.local.get([SAVED_ITEMS_KEY], (result) => {
      const byProject =
        (result[SAVED_ITEMS_KEY] as Record<string, SavedItem[]>) ?? {}
      setSavedItemsByProject(byProject)
    })
  }, [])

  useEffect(() => {
    return registerSaveShortcut(() => {
      const result = saveHighlightedSelection(
        saveShortcutTarget.projectKey,
        saveShortcutTarget.projectLabel,
      )
      setSaveStatus(result.message)
    })
  }, [saveShortcutTarget])

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 14

    const timer = window.setInterval(() => {
      const raw = window.sessionStorage.getItem(PENDING_HIGHLIGHT_KEY)
      if (!raw) return

      let pending: PendingHighlight
      try {
        pending = JSON.parse(raw) as PendingHighlight
      } catch {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        return
      }

      if (!pending.text) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        return
      }

      // expire stale highlight requests after 20 seconds
      if (Date.now() - pending.createdAt > 20_000) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        return
      }

      const highlightCount = applyHighlightToSnippet(pending.text)
      attempts += 1
      if (highlightCount > 0) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        setSaveStatus(
          highlightCount === 1
            ? 'Highlighted 1 match in email.'
            : `Highlighted ${highlightCount} matches in email.`,
        )
      } else if (attempts >= maxAttempts) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        setSaveStatus('Could not find that text in this email.')
      }
    }, 700)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!saveStatus) return
    const timer = window.setTimeout(() => setSaveStatus(''), 2200)
    return () => window.clearTimeout(timer)
  }, [saveStatus])

  const handleAddSubmit = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const parentPath = openedProjectPath ?? []
    const siblings = openedProjectPath ? openedProjectChildren : rootProjects
    if (siblings.some((node) => node.name === trimmed)) return
    addProject(trimmed, parentPath)
    const nextPath = [...parentPath, trimmed]
    setSelectedPath(nextPath)
    if (openedProjectPath) {
      setOpenedProjectPath(nextPath)
    }
    setNewName('')
    setAddOpen(false)
  }

  const closeContextMenu = () => {
    setMenuProjectPath(null)
    setMenuPos(null)
  }

  const closeSnippetContextMenu = () => {
    setSnippetMenuItemId(null)
    setSnippetMenuStorageKey(null)
    setSnippetMenuPos(null)
  }

  const handleRenameSubmit = () => {
    const trimmed = renameName.trim()
    if (!renameFromPath || !trimmed) return
    const currentName = renameFromPath[renameFromPath.length - 1] ?? ''
    if (trimmed === currentName) return
    const renamed = renameProject(renameFromPath, trimmed)
    if (renamed && isSamePath(selectedPath, renameFromPath)) {
      setSelectedPath([...renameFromPath.slice(0, -1), trimmed])
    }
    if (renamed && isSamePath(openedProjectPath, renameFromPath)) {
      setOpenedProjectPath([...renameFromPath.slice(0, -1), trimmed])
    }
    setRenameOpen(false)
    setRenameFromPath(null)
    setRenameName('')
  }

  const handleDeleteProject = () => {
    if (!menuProjectPath) return
    const removed = deleteProject(menuProjectPath)
    if (
      removed &&
      selectedPath &&
      selectedPath.length >= menuProjectPath.length &&
      menuProjectPath.every((part, index) => selectedPath[index] === part)
    ) {
      setSelectedPath(null)
    }
    if (
      removed &&
      openedProjectPath &&
      openedProjectPath.length >= menuProjectPath.length &&
      menuProjectPath.every((part, index) => openedProjectPath[index] === part)
    ) {
      const parentPath = menuProjectPath.slice(0, -1)
      setOpenedProjectPath(parentPath.length > 0 ? parentPath : null)
    }
    closeContextMenu()
  }

  return (
    <Box
      sx={{
        pointerEvents: 'auto',
        width,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        borderLeft: '1px solid',
        borderColor: 'divider',
        transition: 'width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      <SidebarHeader
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />

      {!collapsed && (
        <>
          <Box sx={{ px: 1.5, pt: 2, pb: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <ProjectsToolbar
              addOpen={addOpen}
              isOpenedView={isOpenedView}
              label={openedProjectLabel}
              onBack={() => {
                if (openedProjectPath) {
                  if (openedProjectPath.length > 1) {
                    setOpenedProjectPath(openedProjectPath.slice(0, -1))
                  } else {
                    setOpenedProjectPath(null)
                  }
                  return
                }
              }}
              onToggleAdd={() => {
                if (addOpen) {
                  setAddOpen(false)
                } else {
                  setNewName('')
                  setAddOpen(true)
                }
              }}
            />
            {!isOpenedView ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {addOpen && (
                <ProjectInlineForm
                  value={newName}
                  placeholder="New project"
                  submitAriaLabel="Save new project"
                  cancelAriaLabel="Cancel new project"
                  onChange={setNewName}
                  onCancel={() => setAddOpen(false)}
                  onSubmit={handleAddSubmit}
                />
              )}
              {rootProjects.map((node) => {
                const path = [node.name]
                const isRenameTarget = renameOpen && isSamePath(renameFromPath, path)
                return isRenameTarget ? (
                  <Box key={node.name}>
                    <ProjectRenameInlineForm
                      value={renameName}
                      onChange={setRenameName}
                      renameFromPath={renameFromPath}
                      onSubmit={handleRenameSubmit}
                      onCancel={() => setRenameOpen(false)}
                      placeholder="Project name"
                      saveAriaLabel="Save project rename"
                      cancelAriaLabel="Cancel project rename"
                    />
                  </Box>
                ) : (
                  <Box key={node.name}>
                    <FolderButton
                      name={node.name}
                      isActive={isSamePath(selectedPath, path)}
                      onClick={() => {
                        setSelectedPath(path)
                      }}
                      onDoubleClick={() => {
                        setSelectedPath(path)
                        setOpenedProjectPath(path)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenuProjectPath(path)
                        setMenuPos({ top: e.clientY, left: e.clientX })
                      }}
                      startIcon={
                        <FolderOutlinedIcon
                          sx={{
                            fontSize: 18,
                            opacity: isSamePath(selectedPath, path) ? 1 : 0.7,
                          }}
                        />
                      }
                    />
                  </Box>
                )
              })}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 0.5 }}>
                  <SavedSnippetsList
                    items={rootSnippetsItems}
                    showEmptyMessage={rootProjects.length === 0}
                    onSnippetContextMenu={(id, position) => {
                      closeContextMenu()
                      setSnippetMenuItemId(id)
                      setSnippetMenuStorageKey(ROOT_SNIPPETS_KEY)
                      setSnippetMenuPos(position)
                    }}
                  />
                </Box>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {addOpen && (
                  <ProjectInlineForm
                    value={newName}
                    placeholder="New subfolder"
                    submitAriaLabel="Save new subfolder"
                    cancelAriaLabel="Cancel new subfolder"
                    onChange={setNewName}
                    onCancel={() => setAddOpen(false)}
                    onSubmit={handleAddSubmit}
                  />
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {openedProjectChildren.map((node) => {
                    const parentPath = openedProjectPath ?? []
                    const path = [...parentPath, node.name]
                    const isRenameTarget = renameOpen && isSamePath(renameFromPath, path)
                    return isRenameTarget ? (
                      <Box key={path.join('\u0000')}>
                        <ProjectRenameInlineForm
                          value={renameName}
                          onChange={setRenameName}
                          renameFromPath={renameFromPath}
                          onSubmit={handleRenameSubmit}
                          onCancel={() => setRenameOpen(false)}
                          placeholder="Folder name"
                          saveAriaLabel="Save folder rename"
                          cancelAriaLabel="Cancel folder rename"
                        />
                      </Box>
                    ) : (
                      <Box key={path.join('\u0000')}>
                        <FolderButton
                          name={node.name}
                          isActive={isSamePath(selectedPath, path)}
                          onClick={() => setSelectedPath(path)}
                          onDoubleClick={() => {
                            setSelectedPath(path)
                            setOpenedProjectPath(path)
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setMenuProjectPath(path)
                            setMenuPos({ top: e.clientY, left: e.clientX })
                          }}
                          startIcon={
                            <FolderOutlinedIcon
                              sx={{
                                fontSize: 18,
                                opacity: isSamePath(selectedPath, path) ? 1 : 0.7,
                              }}
                            />
                          }
                        />
                      </Box>
                    )
                  })}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <SavedSnippetsList
                    items={openedProjectItems}
                    showEmptyMessage={openedProjectChildren.length === 0}
                    onSnippetContextMenu={(id, position) => {
                      closeContextMenu()
                      setSnippetMenuItemId(id)
                      if (openedProjectPath) {
                        setSnippetMenuStorageKey(getProjectStorageKey(openedProjectPath))
                      }
                      setSnippetMenuPos(position)
                    }}
                  />
                </Box>
              </Box>
            )}
          </Box>
        </>
      )}
      <Toast message={saveStatus} visible={Boolean(saveStatus)} />
      <Menu
        open={Boolean(menuPos)}
        onClose={closeContextMenu}
        disableScrollLock
        disablePortal
        anchorReference="anchorPosition"
        anchorPosition={
          menuPos ? { top: menuPos.top, left: menuPos.left } : undefined
        }
      >
        <MenuItem
          onClick={() => {
            if (!menuProjectPath) return
            setRenameFromPath(menuProjectPath)
            setRenameName(menuProjectPath[menuProjectPath.length - 1] ?? '')
            setRenameOpen(true)
            setAddOpen(false)
            closeContextMenu()
          }}
        >
          Rename
        </MenuItem>
        <MenuItem onClick={handleDeleteProject}>Delete</MenuItem>
      </Menu>
      <Menu
        open={Boolean(snippetMenuPos)}
        onClose={closeSnippetContextMenu}
        disableScrollLock
        disablePortal
        anchorReference="anchorPosition"
        anchorPosition={
          snippetMenuPos
            ? { top: snippetMenuPos.top, left: snippetMenuPos.left }
            : undefined
        }
      >
        <MenuItem
          onClick={() => {
            if (!snippetMenuItemId || !snippetMenuStorageKey) return
            handleDeleteSavedSnippet(snippetMenuItemId, snippetMenuStorageKey)
            closeSnippetContextMenu()
          }}
        >
          Delete
        </MenuItem>
      </Menu>
    </Box>
  )
}
