type ShortcutHandler = () => void

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false

  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.isContentEditable
  )
}

export function registerSaveShortcut(onTrigger: ShortcutHandler): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return

    const isSlash = event.key === '/'
    const hasModifier = event.metaKey || event.ctrlKey
    if (!isSlash || !hasModifier) return

    event.preventDefault()
    onTrigger()
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
