import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { PENDING_HIGHLIGHT_KEY } from '../utils/storageKeys'

function getSafeHref(link: string): string | undefined {
  try {
    const { protocol } = new URL(link)
    return protocol === 'https:' || protocol === 'http:' ? link : undefined
  } catch {
    return undefined
  }
}

type SavedSnippet = {
  id: string
  text: string
  link: string
}

type SavedSnippetsListProps = {
  items: SavedSnippet[]
  onSnippetContextMenu: (id: string, position: { top: number; left: number }) => void
  showEmptyMessage?: boolean
}

export default function SavedSnippetsList({
  items,
  onSnippetContextMenu,
  showEmptyMessage = true,
}: SavedSnippetsListProps) {
  if (items.length === 0) {
    if (!showEmptyMessage) return null
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
        No saved items yet.
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((item) => (
        <Box
          key={item.id}
          component="a"
          href={getSafeHref(item.link)}
          onClick={(event) => {
            event.preventDefault()
            const safeHref = getSafeHref(item.link)
            if (!safeHref) return
            window.sessionStorage.setItem(
              PENDING_HIGHLIGHT_KEY,
              JSON.stringify({ text: item.text, createdAt: Date.now() }),
            )
            window.location.assign(safeHref)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            onSnippetContextMenu(item.id, { top: event.clientY, left: event.clientX })
          }}
          title={item.text}
          sx={{
            px: 0.25,
            py: 1,
            textDecoration: 'none',
            borderBottom: '1px solid',
            borderColor: 'divider',
            transition: 'background-color 120ms ease',
            borderRadius: 1,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            '&:hover': {
              bgcolor: '#f8f9fa',
            },
            '&:active': {
              bgcolor: '#eef3fd',
            },
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: '#202124',
              fontWeight: 400,
              lineHeight: 1.4,
              fontFamily:
                '"Google Sans", Roboto, "Helvetica Neue", Arial, sans-serif',
              display: '-webkit-box',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              whiteSpace: 'pre-line',
              wordBreak: 'break-word',
            }}
          >
            {item.text}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}
