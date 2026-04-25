import Box from '@mui/material/Box'

type ToastProps = {
  message: string
  visible: boolean
}

export default function Toast({ message, visible }: ToastProps) {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        px: 1.5,
        py: 0.75,
        borderRadius: 999,
        bgcolor: '#202124',
        color: '#fff',
        fontSize: 12,
        fontWeight: 400,
        fontFamily:
          '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 10px rgba(60,64,67,0.35)',
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        transition: 'opacity 140ms ease',
        zIndex: 20,
      }}
    >
      {message}
    </Box>
  )
}
