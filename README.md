# Email Filer

A Chrome extension that lets you save highlighted text snippets from Gmail and organise them into folders, backed by your own Google Drive.

## Features

- Highlight text in a Gmail email and save it with one click or a keyboard shortcut
- Organise snippets into nested folders, mirrored as real Drive folders
- Click a saved snippet to jump back to it in the original email
- All data lives in your own Google Drive (`drive.file` scope — no other Drive files are accessible)
- No backend servers

## Development

```bash
npm run deps          # install dependencies
npm run build:extension   # build the extension into client/dist/
```

Load the extension in Chrome via **chrome://extensions → Load unpacked → select `client/dist/`**.

## Privacy

See [docs/privacy.html](docs/privacy.html) for the full privacy policy.
