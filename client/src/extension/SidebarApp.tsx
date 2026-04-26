import { useCallback, useEffect, useMemo, useState } from 'react'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import AddToDriveOutlinedIcon from '@mui/icons-material/AddToDriveOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import FolderButton from './components/FolderButton'
import ProjectInlineForm from './components/ProjectInlineForm'
import ProjectRenameInlineForm from './components/ProjectRenameInlineForm'
import ProjectsToolbar from './components/ProjectsToolbar'
import SavedSnippetsList from './components/SavedSnippetsList'
import SidebarHeader from './components/SidebarHeader'
import Toast from './components/Toast'
import { DRIVE_CONNECTED_KEY, PENDING_HIGHLIGHT_KEY, SYNC_STATUS_KEY } from './utils/storageKeys'
import { applyHighlightToSnippet } from './utils/highlightSnippet'
import {
  registerSaveShortcut,
  registerToggleSidebarShortcut,
} from './utils/shortcuts'
import {
  getNodeAtPath,
  useExtensionProjects,
} from './utils/useExtensionProjects'

const SIDEBAR_WIDTH = 320
const SIDEBAR_WIDTH_COLLAPSED = 48
const ROOT_SNIPPETS_KEY = '__root__'
const ROOT_SNIPPETS_LABEL = 'Root folder'

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

type RuntimeResponse<T = unknown> = {
  ok?: boolean
  error?: string
} & T

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

function sendRuntimeMessage<T = unknown>(message: unknown): Promise<T> {
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

export default function SidebarApp() {
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'syncing' | 'error'>('synced')
  const [collapsed, setCollapsed] = useState(false)
  const { projects, addProject, renameProject, deleteProject } = useExtensionProjects(
    driveConnected,
  )
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
  const [snippetMenuPath, setSnippetMenuPath] = useState<ProjectPath | null>(null)
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

  const saveShortcutTarget = useMemo(() => {
    if (openedProjectPath) {
      return {
        projectKey: getProjectStorageKey(openedProjectPath),
        projectLabel: openedProjectLabel,
      }
    }
    return { projectKey: ROOT_SNIPPETS_KEY, projectLabel: ROOT_SNIPPETS_LABEL }
  }, [openedProjectPath, openedProjectLabel])

  const loadSnippetsForPath = useCallback(async (path: ProjectPath | null) => {
    const response = await sendRuntimeMessage<
      RuntimeResponse<{ snippets?: SavedItem[] }>
    >({
      type: 'emailFilerListSnippets',
      path: path ?? [],
    })
    if (!response?.ok) {
      throw new Error(response?.error ?? 'Failed to load snippets from Drive.')
    }
    const key = path ? getProjectStorageKey(path) : ROOT_SNIPPETS_KEY
    setSavedItemsByProject((prev) => ({ ...prev, [key]: response.snippets ?? [] }))
  }, [])

  const handleDeleteSavedSnippet = async (
    snippetId: string,
    projectKey: string,
    path: ProjectPath | null,
  ) => {
    try {
      const response = await sendRuntimeMessage<RuntimeResponse>({
        type: 'emailFilerDeleteSnippet',
        snippetId,
      })
      if (!response?.ok) {
        throw new Error(response?.error ?? 'Failed to delete snippet.')
      }
      setSavedItemsByProject((prev) => ({
        ...prev,
        [projectKey]: (prev[projectKey] ?? []).filter((item) => item.id !== snippetId),
      }))
      await loadSnippetsForPath(path)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to delete snippet.')
    }
  }

  const saveHighlightedSelection = useCallback(async (
    path: ProjectPath | null,
    projectKey: string,
    projectLabel: string,
  ): Promise<SaveResult> => {
    const selection = window.getSelection()?.toString() ?? ''
    if (!selection.trim()) {
      return { ok: false, message: 'Highlight text in an email first.' }
    }

    const link = window.location.href
    try {
      const response = await sendRuntimeMessage<
        RuntimeResponse<{ snippet?: SavedItem }>
      >({
        type: 'emailFilerSaveSnippet',
        path: path ?? [],
        text: selection,
        link,
      })
      if (!response?.ok) {
        return { ok: false, message: response?.error ?? 'Failed to save snippet.' }
      }
      const created = response.snippet
      if (created) {
        setSavedItemsByProject((prev) => ({
          ...prev,
          [projectKey]: [created, ...(prev[projectKey] ?? [])],
        }))
      }
      await loadSnippetsForPath(path)
      return { ok: true, message: `Saved to ${projectLabel}.` }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to save snippet.',
      }
    }
  }, [loadSnippetsForPath])

  useEffect(() => {
    chrome.storage.local.get([DRIVE_CONNECTED_KEY, SYNC_STATUS_KEY], (result) => {
      setDriveConnected(Boolean(result[DRIVE_CONNECTED_KEY]))
      const initialSyncStatus = result[SYNC_STATUS_KEY]
      if (
        initialSyncStatus === 'synced' ||
        initialSyncStatus === 'pending' ||
        initialSyncStatus === 'syncing' ||
        initialSyncStatus === 'error'
      ) {
        setSyncStatus(initialSyncStatus)
      }
    })

    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== 'local') return
      if (DRIVE_CONNECTED_KEY in changes) {
        setDriveConnected(Boolean(changes[DRIVE_CONNECTED_KEY]?.newValue))
      }
      if (SYNC_STATUS_KEY in changes) {
        const next = changes[SYNC_STATUS_KEY]?.newValue
        if (next === 'synced' || next === 'pending' || next === 'syncing' || next === 'error') {
          setSyncStatus(next)
        }
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  useEffect(() => {
    if (!driveConnected) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSnippetsForPath(null).catch((error) => {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to load snippets.')
    })
  }, [driveConnected, loadSnippetsForPath])

  useEffect(() => {
    if (!driveConnected || !openedProjectPath) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSnippetsForPath(openedProjectPath).catch((error) => {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to load snippets.')
    })
  }, [driveConnected, loadSnippetsForPath, openedProjectPath, projects])

  useEffect(() => {
    return registerSaveShortcut(() => {
      void saveHighlightedSelection(
        openedProjectPath,
        saveShortcutTarget.projectKey,
        saveShortcutTarget.projectLabel,
      ).then((result) => {
        setSaveStatus(result.message)
      })
    })
  }, [openedProjectPath, saveHighlightedSelection, saveShortcutTarget])

  useEffect(() => {
    return registerToggleSidebarShortcut(() => {
      setCollapsed((current) => !current)
    })
  }, [])

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

      if (!pending.text || Date.now() - pending.createdAt > 20_000) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
        return
      }

      const highlightCount = applyHighlightToSnippet(pending.text)
      attempts += 1
      if (highlightCount > 0 || attempts >= maxAttempts) {
        window.sessionStorage.removeItem(PENDING_HIGHLIGHT_KEY)
      }
    }, 700)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!saveStatus) return
    const timer = window.setTimeout(() => setSaveStatus(''), 2200)
    return () => window.clearTimeout(timer)
  }, [saveStatus])

  const handleAddSubmit = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const parentPath = openedProjectPath ?? []
    try {
      const actualName = await addProject(trimmed, parentPath)
      if (!actualName) return
      const nextPath = [...parentPath, actualName]
      setSelectedPath(nextPath)
      setNewName('')
      setAddOpen(false)
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to create folder.')
    }
  }

  const closeContextMenu = () => {
    setMenuProjectPath(null)
    setMenuPos(null)
  }

  const closeSnippetContextMenu = () => {
    setSnippetMenuItemId(null)
    setSnippetMenuPath(null)
    setSnippetMenuPos(null)
  }

  const handleRenameSubmit = async () => {
    const trimmed = renameName.trim()
    if (!renameFromPath || !trimmed) return
    const currentName = renameFromPath[renameFromPath.length - 1] ?? ''
    if (trimmed === currentName) return
    try {
      const renamed = await renameProject(renameFromPath, trimmed)
      if (!renamed) return
      if (isSamePath(selectedPath, renameFromPath)) {
        setSelectedPath([...renameFromPath.slice(0, -1), trimmed])
      }
      if (isSamePath(openedProjectPath, renameFromPath)) {
        setOpenedProjectPath([...renameFromPath.slice(0, -1), trimmed])
      }
      setRenameOpen(false)
      setRenameFromPath(null)
      setRenameName('')
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to rename folder.')
    }
  }

  const handleDeleteProject = async () => {
    if (!menuProjectPath) return
    try {
      const removed = await deleteProject(menuProjectPath)
      if (!removed) return

      if (
        selectedPath &&
        selectedPath.length >= menuProjectPath.length &&
        menuProjectPath.every((part, index) => selectedPath[index] === part)
      ) {
        setSelectedPath(null)
      }
      if (
        openedProjectPath &&
        openedProjectPath.length >= menuProjectPath.length &&
        menuProjectPath.every((part, index) => openedProjectPath[index] === part)
      ) {
        const parentPath = menuProjectPath.slice(0, -1)
        setOpenedProjectPath(parentPath.length > 0 ? parentPath : null)
      }
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Failed to delete folder.')
    }
    closeContextMenu()
  }

  const handleDisconnectDrive = () => {
    chrome.runtime.sendMessage(
      { type: 'emailFilerDisconnectDrive' },
      (response?: { ok?: boolean; error?: string }) => {
        if (chrome.runtime.lastError || !response?.ok) {
          setSaveStatus(response?.error ?? 'Failed to disconnect Drive.')
          return
        }
        setDriveConnected(false)
        setSavedItemsByProject({})
        setOpenedProjectPath(null)
        setSelectedPath(null)
      },
    )
  }

  const handleConnectGoogleDrive = () => {
    if (driveConnecting) return
    setDriveConnecting(true)
    chrome.runtime.sendMessage(
      { type: 'emailFilerConnectDrive' },
      (response?: { ok?: boolean; error?: string }) => {
        setDriveConnecting(false)
        if (chrome.runtime.lastError) {
          setSaveStatus(chrome.runtime.lastError.message ?? 'Failed to connect Drive.')
          return
        }
        if (!response?.ok) {
          setSaveStatus(response?.error ?? 'Failed to connect Drive.')
          return
        }
        setDriveConnected(true)
        setSaveStatus('Google Drive connected.')
      },
    )
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
        syncStatus={driveConnected ? syncStatus : undefined}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        onDisconnectDrive={driveConnected ? handleDisconnectDrive : undefined}
      />

      {!collapsed && (
        <>
          <Box sx={{ px: 1.5, pt: 2, pb: 1, flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {!driveConnected ? (
              <Box
                sx={{
                  minHeight: 220,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1.25,
                  textAlign: 'center',
                }}
              >
                <Button
                  onClick={handleConnectGoogleDrive}
                  disabled={driveConnecting}
                  aria-label="Connect Google Drive"
                  sx={{
                    minWidth: 0,
                    width: 72,
                    height: 72,
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    color: 'primary.main',
                  }}
                >
                  <AddToDriveOutlinedIcon sx={{ fontSize: 34 }} />
                </Button>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {driveConnecting ? 'Connecting...' : 'Connect Google Drive'}
                </Typography>
              </Box>
            ) : (
              <>
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
                          setSnippetMenuPath(null)
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
                            setSnippetMenuPath(openedProjectPath)
                          }
                          setSnippetMenuPos(position)
                        }}
                      />
                    </Box>
                  </Box>
                )}
              </>
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
            if (!snippetMenuItemId) return
            const key = snippetMenuPath
              ? getProjectStorageKey(snippetMenuPath)
              : ROOT_SNIPPETS_KEY
            void handleDeleteSavedSnippet(snippetMenuItemId, key, snippetMenuPath)
            closeSnippetContextMenu()
          }}
        >
          Delete
        </MenuItem>
      </Menu>
    </Box>
  )
}
