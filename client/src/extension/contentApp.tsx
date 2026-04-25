import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import SidebarApp from './SidebarApp'
import { gmailChromeTheme } from './gmailTheme'

const HOST_ID = 'email-filer-sidebar-host'

function ensureFontsLink() {
  const href =
    'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500;700&display=swap'
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

function mount() {
  if (document.getElementById(HOST_ID)) return

  ensureFontsLink()

  const host = document.createElement('div')
  host.id = HOST_ID
  host.setAttribute('data-email-filer-extension', '')
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    zIndex: '2147483646',
    height: '100vh',
    display: 'flex',
    justifyContent: 'flex-end',
    pointerEvents: 'none',
  })

  const shadow = host.attachShadow({ mode: 'open' })
  const baseStyle = document.createElement('style')
  baseStyle.textContent = `
    :host, * {
      font-family: "Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
  `
  shadow.appendChild(baseStyle)

  const mountPoint = document.createElement('div')
  mountPoint.style.cssText = 'height:100%;display:flex;flex-direction:column;'
  shadow.appendChild(mountPoint)

  const cache = createCache({
    key: 'email-filer-mui',
    prepend: true,
    container: shadow,
  })

  document.documentElement.appendChild(host)

  const root = createRoot(mountPoint)
  root.render(
    <StrictMode>
      <CacheProvider value={cache}>
        <ThemeProvider theme={gmailChromeTheme}>
          <CssBaseline />
          <SidebarApp />
        </ThemeProvider>
      </CacheProvider>
    </StrictMode>,
  )
}

mount()
