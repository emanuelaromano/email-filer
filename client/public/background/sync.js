let syncInProgress = false
let debounceSyncTimeout = null

function scheduleLocalStateSync() {
  if (debounceSyncTimeout !== null) {
    clearTimeout(debounceSyncTimeout)
  }
  debounceSyncTimeout = setTimeout(() => {
    debounceSyncTimeout = null
    void trySyncLocalStateToDrive()
  }, SYNC_DEBOUNCE_MS)

  // Fallback wake-up in case the MV3 worker is suspended before the timeout fires.
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: SYNC_ALARM_FALLBACK_DELAY_MINUTES,
  })
}

async function trySyncLocalStateToDrive() {
  if (syncInProgress) return
  syncInProgress = true
  try {
    const connectedResult = await chrome.storage.local.get([DRIVE_CONNECTED_KEY])
    if (!connectedResult[DRIVE_CONNECTED_KEY]) return
    const dirty = await isLocalStateDirty()
    if (!dirty) return
    const syncRevision = await getLocalStateRevision()
    await setSyncStatus('syncing')
    const state = await getLocalState()
    await withToken(async (token) => {
      const rootFolderId = await getRootFolderIdOrThrow()
      await pushStateToDriveAsFolders(token, rootFolderId, state)
      const latestRevision = await getLocalStateRevision()
      if (latestRevision === syncRevision) {
        await markLocalStateClean()
        await setSyncStatus('synced')
        return
      }
      await setSyncStatus('pending')
    })
  } catch {
    await setSyncStatus('error')
  } finally {
    syncInProgress = false
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM_NAME) return
  if (debounceSyncTimeout !== null) {
    clearTimeout(debounceSyncTimeout)
    debounceSyncTimeout = null
  }
  void trySyncLocalStateToDrive()
})
