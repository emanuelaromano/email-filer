import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined'
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

type SidebarHeaderProps = {
  collapsed: boolean
  syncStatus?: 'synced' | 'pending' | 'syncing' | 'error'
  onToggleCollapsed: () => void
}

export default function SidebarHeader({
  collapsed,
  syncStatus,
  onToggleCollapsed,
}: SidebarHeaderProps) {
  return (
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
        <Box sx={{ pl: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" component="h1">
            Email Filer
          </Typography>
          {syncStatus && (
            <Box
              component="span"
              role="status"
              aria-label={syncStatus === 'synced' ? 'Synced' : 'Unsynced'}
              title={syncStatus === 'synced' ? 'Synced' : 'Unsynced'}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
              }}
            >
              {syncStatus === 'synced' ? (
                <CloudDoneOutlinedIcon sx={{ fontSize: 18 }} />
              ) : (
                <CloudOffOutlinedIcon sx={{ fontSize: 18 }} />
              )}
            </Box>
          )}
        </Box>
      )}
      <IconButton
        size="small"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        sx={{ color: 'secondary.main' }}
      >
        {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </IconButton>
    </Box>
  )
}
