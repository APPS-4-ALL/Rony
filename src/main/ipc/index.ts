import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import { countInvoices, insertInvoice, listInvoices } from '../db'

/**
 * Registers all main-process IPC handlers. Uses `ipcMain.handle` so each call
 * is a typed request/response round-trip (the renderer awaits a return value),
 * which is the secure, modern pattern with context isolation enabled.
 *
 * Call once, after the database has been initialised.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')

  ipcMain.handle(IpcChannels.invoicesList, () => listInvoices())

  ipcMain.handle(IpcChannels.invoicesCount, () => countInvoices())

  ipcMain.handle(IpcChannels.invoicesAddSample, () =>
    insertInvoice({
      messageId: `sample-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      vendor: 'Sample Vendor Ltd.',
      amount: Math.round(Math.random() * 100000) / 100,
      currency: 'ILS',
      localFilePath: null,
      status: 'pending',
      engineType: 'deterministic'
    })
  )
}
