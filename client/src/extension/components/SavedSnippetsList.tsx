import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

const PENDING_HIGHLIGHT_KEY = 'emailFilerPendingHighlight'

type SavedSnippet = {
  id: string
  text: string
  link: string
}

type SavedSnippetsListProps = {
  items: SavedSnippet[]
}

export default function SavedSnippetsList({ items }: SavedSnippetsListProps) {
  if (items.length === 0) {
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
          href={item.link}
          onClick={(event) => {
            event.preventDefault()
            const payload = {
              text: item.text,
              createdAt: Date.now(),
            }
            window.sessionStorage.setItem(PENDING_HIGHLIGHT_KEY, JSON.stringify(payload))
            window.location.assign(item.link)
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
