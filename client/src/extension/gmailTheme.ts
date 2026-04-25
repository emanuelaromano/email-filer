import { createTheme } from '@mui/material/styles'

/** Material surfaces and type tuned to match Gmail’s light chrome (2024). */
export const gmailChromeTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1a73e8' },
    secondary: { main: '#5f6368' },
    background: {
      default: '#f6f8fc',
      paper: '#ffffff',
    },
    text: {
      primary: '#202124',
      secondary: '#5f6368',
    },
    divider: '#dadce0',
  },
  typography: {
    fontFamily:
      '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    h6: { fontSize: '0.9375rem', fontWeight: 500, letterSpacing: '0.00625em' },
    body2: { fontSize: '0.8125rem', lineHeight: 1.25 },
    caption: { fontSize: '0.6875rem', color: '#5f6368' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButtonBase: {
      defaultProps: {
        disableRipple: true,
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFeatureSettings: '"liga" 1' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow:
            '0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 999, fontWeight: 500 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#f1f3f4',
          '& fieldset': { borderColor: 'transparent' },
          '&:hover fieldset': { borderColor: '#dadce0' },
          '&.Mui-focused fieldset': { borderColor: '#1a73e8' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          '&:hover': { backgroundColor: 'rgba(32,33,36,0.059)' },
          '&.Mui-selected': {
            backgroundColor: 'rgba(26,115,232,0.12)',
            '&:hover': { backgroundColor: 'rgba(26,115,232,0.16)' },
          },
        },
      },
    },
  },
})
