/**
 * Canonical IPC channel names shared between the main process (ipcMain.handle)
 * and the preload bridge (ipcRenderer.invoke). Defining them once avoids
 * string drift between the two sides of the boundary.
 */
export const IpcChannels = {
  invoicesList: 'invoices:list',
  invoicesOpenFile: 'invoices:openFile',
  invoicesDelete: 'invoices:delete',
  invoicesDeleteAll: 'invoices:deleteAll',
  // --- Step-0 contract additions ---
  authStatus: 'auth:status',
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:setApiKey',
  settingsHasApiKey: 'settings:hasApiKey',
  settingsClearApiKey: 'settings:clearApiKey',
  scanRun: 'scan:run',
  /** Request cancellation of the in-flight scan (cooperative; stops between items). */
  scanCancel: 'scan:cancel',
  /** One-way main → renderer event carrying live scan progress. */
  scanProgress: 'scan:progress',
  dialogSaveFile: 'dialog:saveFile',
  dialogPickFolder: 'dialog:pickFolder'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
