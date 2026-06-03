/**
 * Canonical IPC channel names shared between the main process (ipcMain.handle)
 * and the preload bridge (ipcRenderer.invoke). Defining them once avoids
 * string drift between the two sides of the boundary.
 */
export const IpcChannels = {
  ping: 'app:ping',
  invoicesList: 'invoices:list',
  invoicesCount: 'invoices:count',
  invoicesAddSample: 'invoices:addSample',
  invoicesOpenFile: 'invoices:openFile',
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
  /** One-way main → renderer event carrying live scan progress. */
  scanProgress: 'scan:progress',
  dialogSaveFile: 'dialog:saveFile'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
