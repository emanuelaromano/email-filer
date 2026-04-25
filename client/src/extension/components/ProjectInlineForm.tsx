import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import type { FormEvent } from 'react'

type ProjectInlineFormProps = {
  value: string
  placeholder: string
  submitAriaLabel: string
  cancelAriaLabel: string
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export default function ProjectInlineForm({
  value,
  placeholder,
  submitAriaLabel,
  cancelAriaLabel,
  onChange,
  onCancel,
  onSubmit,
}: ProjectInlineFormProps) {
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
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
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
          fontFamily: '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
          '::placeholder': {
            color: 'rgba(4,30,73,0.65)',
            opacity: 1,
          },
        }}
      />
      <IconButton
        type="submit"
        size="small"
        aria-label={submitAriaLabel}
        disabled={!value.trim()}
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
