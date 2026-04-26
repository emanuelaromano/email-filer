import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'

type ToastProps = {
  message: string
  visible: boolean
}

export default function Toast({ message, visible }: ToastProps) {
  const portalRoot = useMemo(() => {
    const node = document.createElement('div')
    node.setAttribute('data-email-filer-toast-root', '')
    return node
  }, [])

  useEffect(() => {
    document.documentElement.appendChild(portalRoot)
    return () => {
      portalRoot.remove()
    }
  }, [portalRoot])

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: '58px',
        bottom: '16px',
        padding: '6px 12px',
        borderRadius: '999px',
        backgroundColor: '#202124',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 400,
        fontFamily: '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
        whiteSpace: 'nowrap',
        maxWidth: 'min(360px, calc(100vw - 32px))',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: '0 4px 10px rgba(60,64,67,0.35)',
        opacity: visible ? 1 : 0,
        pointerEvents: 'none',
        transition: 'opacity 140ms ease',
        zIndex: 2147483647,
      }}
    >
      {message}
    </div>,
    portalRoot,
  )
}
