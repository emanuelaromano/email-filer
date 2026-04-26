// DRIVE_CONNECTED_KEY, DRIVE_FOLDER_ID_KEY, and SYNC_STATUS_KEY are mirrored
// in client/public/background/constants.js (service worker cannot import from here).
// If you rename any of these, update that file too.
export const DRIVE_CONNECTED_KEY = 'emailFilerDriveConnected'
export const DRIVE_FOLDER_ID_KEY = 'emailFilerDriveFolderId'
export const SYNC_STATUS_KEY = 'emailFilerSyncStatus'

// Used only by the content script (sessionStorage on the Gmail page).
// Not present in constants.js because the service worker never touches it.
export const PENDING_HIGHLIGHT_KEY = 'emailFilerPendingHighlight'
