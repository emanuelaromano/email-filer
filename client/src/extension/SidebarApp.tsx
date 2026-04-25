import { useEffect, useMemo, useState } from 'react'
import CheckIcon from '@mui/icons-material/Check'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import CloseIcon from '@mui/icons-material/Close'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import FolderButton from './components/FolderButton'
import ProjectInlineForm from './components/ProjectInlineForm'
import ProjectsToolbar from './components/ProjectsToolbar'
import SavedSnippetsList from './components/SavedSnippetsList'
import SidebarHeader from './components/SidebarHeader'
import Toast from './components/Toast'
import { applyHighlightToSnippet } from './utils/highlightSnippet'
import { registerSaveShortcut } from './utils/shortcuts'
import { type ProjectNode, useExtensionProjects } from './useExtensionProjects'

const SIDEBAR_WIDTH = 320
const SIDEBAR_WIDTH_COLLAPSED = 48
const GENERAL = 'General'
const SAVED_ITEMS_KEY = 'emailFilerProjectSavedItems'
const PENDING_HIGHLIGHT_KEY = 'emailFilerPendingHighlight'
const GENERAL_PROJECT_KEY = '__general__'

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

function getNodeAtPath(nodes: ProjectNode[], path: ProjectPath): ProjectNode | null {
  let branch = nodes
  let current: ProjectNode | null = null
  for (const segment of path) {
    current = branch.find((node) => node.name === segment) ?? null
    if (!current) return null
    branch = current.children
  }
  return current
}

function isSamePath(left: ProjectPath | null, right: ProjectPath | null): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((part, index) => part === right[index])
}

function getProjectStorageKey(path: ProjectPath | null): string {
  if (!path || path.length === 0) return GENERAL_PROJECT_KEY
  return JSON.stringify(path)
}

function getLegacyProjectStorageKey(path: ProjectPath | null): string {
  if (!path || path.length === 0) return GENERAL
  return path.join('/')
}

export default function SidebarApp() {
  const [collapsed, setCollapsed] = useState(false)
  const { projects, addProject, renameProject, deleteProject, hydrated } =
    useExtensionProjects()
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
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [savedItemsByProject, setSavedItemsByProject] = useState<
    Record<string, SavedItem[]>
  >({})
  const [openedProjectPath, setOpenedProjectPath] = useState<ProjectPath | null>(null)
  const [openedGeneral, setOpenedGeneral] = useState(false)

  const openedProjectNode = useMemo(
    () => (openedProjectPath ? getNodeAtPath(projects, openedProjectPath) : null),
    [projects, openedProjectPath],
  )
  const isOpenedView = openedGeneral || openedProjectPath !== null
  const rootProjects = projects
  const openedProjectChildren = openedGeneral ? [] : (openedProjectNode?.children ?? [])

  const activeProject = useMemo(() => {
    if (!hydrated) return { label: GENERAL, path: null as ProjectPath | null }
    if (!selectedPath) return { label: GENERAL, path: null as ProjectPath | null }
    const selectedNode = getNodeAtPath(projects, selectedPath)
    if (!selectedNode) return { label: GENERAL, path: null as ProjectPath | null }
    return { label: selectedNode.name, path: selectedPath }
  }, [hydrated, projects, selectedPath])

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH
  const openedProjectItems = openedGeneral
    ? (savedItemsByProject[GENERAL_PROJECT_KEY] ?? savedItemsByProject[GENERAL] ?? [])
    : openedProjectPath
      ? (
          savedItemsByProject[getProjectStorageKey(openedProjectPath)] ??
          savedItemsByProject[getLegacyProjectStorageKey(openedProjectPath)] ??
          []
        )
      : []
  const openedProjectLabel = openedGeneral ? GENERAL : (openedProjectPath?.join(' / ') ?? '')

  const saveHighlightedSelection = (
    projectKey: string,
    projectLabel: string,
    projectPath: ProjectPath | null,
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
      const legacyKey =
        projectKey === GENERAL_PROJECT_KEY
          ? GENERAL
          : getLegacyProjectStorageKey(projectPath)
      const existing = Array.isArray(byProject[projectKey])
        ? byProject[projectKey]
        : (Array.isArray(byProject[legacyKey]) ? byProject[legacyKey] : [])
      const next = {
        ...byProject,
        [projectKey]: [item, ...existing],
      }
      if (legacyKey !== projectKey && legacyKey in next) {
        delete next[legacyKey]
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
        getProjectStorageKey(activeProject.path),
        activeProject.label,
        activeProject.path,
      )
      setSaveStatus(result.message)
    })
  }, [activeProject])

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
    setOpenedGeneral(false)
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
                if (openedGeneral) {
                  setOpenedGeneral(false)
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
              <Box>
                <FolderButton
                  name={GENERAL}
                  isActive={activeProject.path === null}
                      onClick={() => {
                        setSelectedPath(null)
                        setOpenedGeneral(false)
                      }}
                      onDoubleClick={() => {
                        setSelectedPath(null)
                        setOpenedGeneral(true)
                        setOpenedProjectPath(null)
                      }}
                  startIcon={
                    <InboxOutlinedIcon
                      sx={{
                        fontSize: 18,
                        opacity: activeProject.path === null ? 1 : 0.85,
                        color: activeProject.path === null ? '#174ea6' : '#5f6368',
                      }}
                    />
                  }
                />
              </Box>
              {rootProjects.map((node) => {
                const path = [node.name]
                const isRenameTarget = renameOpen && isSamePath(renameFromPath, path)
                return isRenameTarget ? (
                  <Box
                    key={node.name}
                    component="form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleRenameSubmit()
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      py: 1,
                      px: 1.25,
                      borderRadius: 999,
                      border: '1px solid transparent',
                      color: '#041e49',
                      bgcolor: '#d3e3fd',
                      '&:hover': { bgcolor: '#c2dbff' },
                    }}
                  >
                    <FolderOutlinedIcon sx={{ fontSize: 18, color: '#174ea6' }} />
                    <Box
                      component="input"
                      autoFocus
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          setRenameOpen(false)
                        }
                      }}
                      placeholder="Project name"
                      maxLength={80}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        outline: 'none',
                        bgcolor: 'transparent',
                        color: '#041e49',
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        fontFamily:
                          '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
                      }}
                    />
                    <IconButton
                      type="submit"
                      size="small"
                      aria-label="Save project rename"
                      disabled={!renameName.trim() || renameName.trim() === (renameFromPath?.[renameFromPath.length - 1] ?? '')}
                      sx={{ color: 'primary.main' }}
                    >
                      <CheckIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="small"
                      aria-label="Cancel project rename"
                      onClick={() => setRenameOpen(false)}
                      sx={{ color: 'text.secondary' }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ) : (
                  <Box key={node.name}>
                    <FolderButton
                      name={node.name}
                      isActive={isSamePath(activeProject.path, path)}
                      onClick={() => {
                        setSelectedPath(path)
                        setOpenedGeneral(false)
                      }}
                      onDoubleClick={() => {
                        setSelectedPath(path)
                        setOpenedProjectPath(path)
                        setOpenedGeneral(false)
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
                            opacity: isSamePath(activeProject.path, path) ? 1 : 0.7,
                          }}
                        />
                      }
                    />
                  </Box>
                )
              })}
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
                      <Box
                        key={path.join('\u0000')}
                        component="form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          handleRenameSubmit()
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          py: 1,
                          px: 1.25,
                          borderRadius: 999,
                          border: '1px solid transparent',
                          color: '#041e49',
                          bgcolor: '#d3e3fd',
                          '&:hover': { bgcolor: '#c2dbff' },
                        }}
                      >
                        <FolderOutlinedIcon sx={{ fontSize: 18, color: '#174ea6' }} />
                        <Box
                          component="input"
                          autoFocus
                          value={renameName}
                          onChange={(e) => setRenameName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              setRenameOpen(false)
                            }
                          }}
                          placeholder="Folder name"
                          maxLength={80}
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            border: 'none',
                            outline: 'none',
                            bgcolor: 'transparent',
                            color: '#041e49',
                            fontSize: 13,
                            fontWeight: 500,
                            lineHeight: 1.4,
                            fontFamily:
                              '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
                          }}
                        />
                        <IconButton
                          type="submit"
                          size="small"
                          aria-label="Save folder rename"
                          disabled={!renameName.trim() || renameName.trim() === (renameFromPath?.[renameFromPath.length - 1] ?? '')}
                          sx={{ color: 'primary.main' }}
                        >
                          <CheckIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          type="button"
                          size="small"
                          aria-label="Cancel folder rename"
                          onClick={() => setRenameOpen(false)}
                          sx={{ color: 'text.secondary' }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ) : (
                      <Box key={path.join('\u0000')}>
                        <FolderButton
                          name={node.name}
                          isActive={isSamePath(activeProject.path, path)}
                          onClick={() => setSelectedPath(path)}
                          onDoubleClick={() => {
                            setSelectedPath(path)
                            setOpenedProjectPath(path)
                            setOpenedGeneral(false)
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
                                opacity: isSamePath(activeProject.path, path) ? 1 : 0.7,
                              }}
                            />
                          }
                        />
                      </Box>
                    )
                  })}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <SavedSnippetsList items={openedProjectItems} />
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
    </Box>
  )
}
