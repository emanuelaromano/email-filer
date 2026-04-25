import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

type ProjectsToolbarProps = {
  addOpen: boolean
  isOpenedView: boolean
  label: string
  onBack: () => void
  onToggleAdd: () => void
}

export default function ProjectsToolbar({
  addOpen,
  isOpenedView,
  label,
  onBack,
  onToggleAdd,
}: ProjectsToolbarProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {isOpenedView && (
          <IconButton
            size="small"
            aria-label="Back to projects list"
            onClick={onBack}
            sx={{ color: 'text.secondary' }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        )}
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            textTransform: 'uppercase',
            fontWeight: 500,
            letterSpacing: '0.08em',
          }}
        >
          {isOpenedView ? `PROJECTS - ${label}` : 'PROJECTS'}
        </Typography>
      </Box>
      <Tooltip title={addOpen ? 'Close' : 'New project'}>
        <IconButton
          size="small"
          color="primary"
          onClick={onToggleAdd}
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
  )
}
