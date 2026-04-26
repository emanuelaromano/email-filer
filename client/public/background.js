importScripts(
  'background/constants.js',
  'background/auth.js',
  'background/storage.js',
  'background/drive.js',
  'background/sync.js',
  'background/messages.js',
)

void trySyncLocalStateToDrive()

// Clicking the toolbar icon opens Gmail (the only page where the sidebar runs).
chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
    if (tabs.length > 0 && tabs[0].id != null) {
      chrome.tabs.update(tabs[0].id, { active: true })
      if (tabs[0].windowId != null) {
        chrome.windows.update(tabs[0].windowId, { focused: true })
      }
    } else {
      chrome.tabs.create({ url: 'https://mail.google.com/' })
    }
  })
})
