import { useEffect, useMemo, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import CloseIcon from '@mui/icons-material/Close'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import FolderButton from './FolderButton'
import SavedSnippetsList from './SavedSnippetsList'
import Toast from './Toast'
import { registerSaveShortcut } from './shortcuts'
import { useExtensionProjects } from './useExtensionProjects'

const SIDEBAR_WIDTH = 320
const SIDEBAR_WIDTH_COLLAPSED = 48
const GENERAL = 'General'
const SAVED_ITEMS_KEY = 'emailFilerProjectSavedItems'

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

export default function SidebarApp() {
  const [collapsed, setCollapsed] = useState(false)
  const { projects, addProject, renameProject, deleteProject, hydrated } =
    useExtensionProjects()
  const [selected, setSelected] = useState(GENERAL)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameFrom, setRenameFrom] = useState('')
  const [renameName, setRenameName] = useState('')
  const [menuProject, setMenuProject] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const [saveStatus, setSaveStatus] = useState<string>('')
  const [savedItemsByProject, setSavedItemsByProject] = useState<
    Record<string, SavedItem[]>
  >({})
  const [openedProject, setOpenedProject] = useState<string | null>(null)

  const displayNames = useMemo(() => [GENERAL, ...projects], [projects])

  const activeProject = useMemo(() => {
    if (!hydrated) return GENERAL
    return displayNames.includes(selected)
      ? selected
      : (displayNames[0] ?? GENERAL)
  }, [hydrated, displayNames, selected])

  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH
  const openedProjectItems = openedProject ? (savedItemsByProject[openedProject] ?? []) : []

  const saveHighlightedSelection = (projectName: string): SaveResult => {
    const selection = window.getSelection()?.toString().trim() ?? ''
    if (!selection) {
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
      const existing = Array.isArray(byProject[projectName])
        ? byProject[projectName]
        : []
      const next = {
        ...byProject,
        [projectName]: [item, ...existing],
      }
      setSavedItemsByProject(next)
      void chrome.storage.local.set({ [SAVED_ITEMS_KEY]: next })
    })

    return { ok: true, message: `Saved to ${projectName}.` }
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
      const result = saveHighlightedSelection(activeProject)
      setSaveStatus(result.message)
    })
  }, [activeProject])

  useEffect(() => {
    if (!saveStatus) return
    const timer = window.setTimeout(() => setSaveStatus(''), 2200)
    return () => window.clearTimeout(timer)
  }, [saveStatus])

  const handleAddSubmit = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    if (projects.includes(trimmed)) return
    addProject(trimmed)
    setSelected(trimmed)
    setNewName('')
    setAddOpen(false)
  }

  const closeContextMenu = () => {
    setMenuProject(null)
    setMenuPos(null)
  }

  const handleRenameSubmit = () => {
    const trimmed = renameName.trim()
    if (!renameFrom || !trimmed || trimmed === renameFrom) return
    const renamed = renameProject(renameFrom, trimmed)
    if (renamed && selected === renameFrom) {
      setSelected(trimmed)
    }
    setRenameOpen(false)
    setRenameFrom('')
    setRenameName('')
  }

  const handleDeleteProject = () => {
    if (!menuProject) return
    const removed = deleteProject(menuProject)
    if (removed && selected === menuProject) {
      setSelected(GENERAL)
    }
    if (removed && openedProject === menuProject) {
      setOpenedProject(null)
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
      <Box
        component="header"
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          px: collapsed ? 0 : 1.5,
          py: 1,
          minHeight: 56,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {!collapsed && (
          <Typography variant="h6" component="h1" sx={{ pl: 0.5 }}>
            Email Filer
          </Typography>
        )}
        <IconButton
          size="small"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          sx={{ color: 'secondary.main' }}
        >
          {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </IconButton>
      </Box>

      {!collapsed && (
        <>
          <Box sx={{ px: 1.5, pt: 2, pb: 1 }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 1.5,
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', textTransform: 'uppercase', fontWeight: 500, letterSpacing: '0.08em' }}
              >
                {openedProject ? `PROJECTS - ${openedProject}` : 'PROJECTS'}
              </Typography>
              <Tooltip title={addOpen ? 'Close' : 'New project'}>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => {
                    if (addOpen) {
                      setAddOpen(false)
                    } else {
                      setNewName('')
                      setAddOpen(true)
                    }
                  }}
                  aria-label={addOpen ? 'Close new project form' : 'Add project'}
                  aria-expanded={addOpen}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                  }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {!openedProject ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {addOpen && (
                <Box
                  component="form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleAddSubmit()
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
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setAddOpen(false)
                      }
                    }}
                    placeholder="New project"
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
                      '::placeholder': {
                        color: 'rgba(4,30,73,0.65)',
                        opacity: 1,
                      },
                    }}
                  />
                  <IconButton
                    type="submit"
                    size="small"
                    aria-label="Save new project"
                    disabled={!newName.trim()}
                    sx={{ color: 'primary.main' }}
                  >
                    <CheckIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    type="button"
                    size="small"
                    aria-label="Cancel new project"
                    onClick={() => setAddOpen(false)}
                    sx={{ color: 'text.secondary' }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              )}
              {displayNames.map((name) =>
                renameOpen && renameFrom === name ? (
                  <Box
                    key={name}
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
                      disabled={!renameName.trim() || renameName.trim() === renameFrom}
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
                  <Box key={name}>
                    <FolderButton
                      name={name}
                      isActive={activeProject === name}
                      onClick={() => setSelected(name)}
                      onDoubleClick={() => {
                        setSelected(name)
                        setOpenedProject(name)
                      }}
                      onContextMenu={(e) => {
                        if (name === GENERAL || !projects.includes(name)) return
                        e.preventDefault()
                        setMenuProject(name)
                        setMenuPos({ top: e.clientY, left: e.clientX })
                      }}
                      startIcon={
                        name === GENERAL ? (
                          <InboxOutlinedIcon
                            sx={{
                              fontSize: 18,
                              opacity: activeProject === name ? 1 : 0.85,
                              color: activeProject === name ? '#174ea6' : '#5f6368',
                            }}
                          />
                        ) : (
                          <FolderOutlinedIcon
                            sx={{
                              fontSize: 18,
                              opacity: activeProject === name ? 1 : 0.7,
                            }}
                          />
                        )
                      }
                    />
                  </Box>
                ),
              )}
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Button
                    variant="text"
                    color="inherit"
                    size="small"
                    startIcon={<ChevronLeftIcon fontSize="small" />}
                    onClick={() => setOpenedProject(null)}
                    sx={{ textTransform: 'none', pl: 0 }}
                  >
                    Projects
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  <SavedSnippetsList items={openedProjectItems} />
                </Box>
              </Box>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
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
            if (!menuProject) return
            setRenameFrom(menuProject)
            setRenameName(menuProject)
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
