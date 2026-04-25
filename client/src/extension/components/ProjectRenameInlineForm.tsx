import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import type { FormEvent } from 'react'

type ProjectRenameInlineFormProps = {
  value: string
  onChange: (value: string) => void
  renameFromPath: string[] | null
  onSubmit: () => void
  onCancel: () => void
  placeholder: string
  saveAriaLabel: string
  cancelAriaLabel: string
}

export default function ProjectRenameInlineForm({
  value,
  onChange,
  renameFromPath,
  onSubmit,
  onCancel,
  placeholder,
  saveAriaLabel,
  cancelAriaLabel,
}: ProjectRenameInlineFormProps) {
  const currentName = renameFromPath?.[renameFromPath.length - 1] ?? ''
  const trimmed = value.trim()
  const submitDisabled = !trimmed || trimmed === currentName

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder={placeholder}
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
        aria-label={saveAriaLabel}
        disabled={submitDisabled}
        sx={{ color: 'primary.main' }}
      >
        <CheckIcon fontSize="small" />
      </IconButton>
      <IconButton
        type="button"
        size="small"
        aria-label={cancelAriaLabel}
        onClick={onCancel}
        sx={{ color: 'text.secondary' }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}
