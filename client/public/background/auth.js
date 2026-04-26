function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!token) {
        reject(new Error('No token returned.'))
        return
      }
      resolve(token)
    })
  })
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve)
  })
}

async function withToken(work) {
  const token = await getAuthToken(false).catch(() => null)
  if (!token) {
    await chrome.storage.local.set({ [DRIVE_CONNECTED_KEY]: false })
    throw new Error('Session expired. Please reconnect Google Drive.')
  }
  return work(token)
}
