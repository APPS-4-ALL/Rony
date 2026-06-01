/**
 * Canonical IPC channel names shared between the main process (ipcMain.handle)
 * and the preload bridge (ipcRenderer.invoke). Defining them once avoids
 * string drift between the two sides of the boundary.
 */
export const IpcChannels = {
  ping: 'app:ping',
  invoicesList: 'invoices:list',
  invoicesCount: 'invoices:count',
  invoicesAddSample: 'invoices:addSample'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
