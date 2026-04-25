import Button from '@mui/material/Button'
import type { MouseEvent, ReactNode } from 'react'

type FolderButtonProps = {
  name: ReactNode
  isActive: boolean
  startIcon: ReactNode
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
}

export default function FolderButton({
  name,
  isActive,
  startIcon,
  onClick,
  onDoubleClick,
  onContextMenu,
}: FolderButtonProps) {
  return (
    <Button
      fullWidth
      variant="text"
      color="inherit"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      startIcon={startIcon}
      sx={{
        justifyContent: 'flex-start',
        textTransform: 'none',
        fontWeight: 500,
        py: 1,
        px: 1.25,
        borderRadius: 999,
        border: '1px solid transparent',
        color: isActive ? '#041e49' : 'text.primary',
        bgcolor: isActive ? '#d3e3fd' : 'transparent',
        '&:hover': {
          bgcolor: isActive ? '#c2dbff' : 'rgba(32,33,36,0.059)',
        },
      }}
    >
      {name}
    </Button>
  )
}
