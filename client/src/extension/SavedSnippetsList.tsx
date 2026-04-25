import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

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
    <>
      {items.map((item) => (
        <Box
          key={item.id}
          component="a"
          href={item.link}
          title={item.text}
          sx={{
            px: 1.25,
            py: 0.9,
            borderRadius: 2.5,
            border: '1px solid #dadce0',
            bgcolor: '#fff',
            color: '#202124',
            fontSize: 12.5,
            fontWeight: 500,
            lineHeight: 1.4,
            textDecoration: 'none',
            wordBreak: 'break-word',
            boxShadow: '0 1px 1px rgba(60,64,67,0.08)',
            transition:
              'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
            '&:hover': {
              bgcolor: '#f8f9fa',
              borderColor: '#c6c6c6',
              boxShadow: '0 1px 2px rgba(60,64,67,0.16)',
            },
            '&:active': {
              bgcolor: '#eef3fd',
              borderColor: '#aecbfa',
            },
          }}
        >
          {item.text}
        </Box>
      ))}
    </>
  )
}
