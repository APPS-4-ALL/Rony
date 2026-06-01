import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { SaveFileRequest, ScanResult, Settings } from '../../shared/types'
import { countInvoices, insertInvoice, listInvoices } from '../db'
import { getAuthStatus, login, logout } from '../auth'

/* ------------------------------------------------------------------ *
 * Remaining Step-0 STUB state (settings + scan).
 *
 * These in-memory values let the renderer (Person B) build and visually
 * test every UI state BEFORE the real backend lands. Person A replaces each
 * stub body with the real implementation (RONY-7/9/10/11) without changing
 * the channel names or return shapes, so the frontend keeps working.
 *
 * Auth (RONY-6) is now REAL — see ../auth.
 * ------------------------------------------------------------------ */
let stubSettings: Settings = { defaultEngine: 'deterministic' }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Registers all main-process IPC handlers. Uses `ipcMain.handle` so each call
 * is a typed request/response round-trip (the renderer awaits a return value),
 * which is the secure, modern pattern with context isolation enabled.
 *
 * Call once, after the database has been initialised.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')

  // --- Invoices (real, backed by SQLite) ---
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

  // --- Auth (REAL — RONY-6) ---
  ipcMain.handle(IpcChannels.authStatus, () => getAuthStatus())
  ipcMain.handle(IpcChannels.authLogin, () => login())
  ipcMain.handle(IpcChannels.authLogout, () => logout())

  // --- Settings (STUB → RONY-12 persistence) ---
  ipcMain.handle(IpcChannels.settingsGet, (): Settings => stubSettings)
  ipcMain.handle(IpcChannels.settingsSet, (_e, patch: Partial<Settings>): Settings => {
    stubSettings = { ...stubSettings, ...patch }
    return stubSettings
  })

  // --- Scan pipeline (STUB → RONY-7/9/10/11) ---
  // Simulates a background scan so the Sync button (RONY-14) can show a
  // real loading state. Returns an empty-but-valid summary.
  ipcMain.handle(IpcChannels.scanRun, async (): Promise<ScanResult> => {
    await sleep(1200)
    return { scanned: 0, matched: 0, downloaded: 0, errors: 0 }
  })

  // --- Native save dialog (REAL — usable today by RONY-15) ---
  ipcMain.handle(
    IpcChannels.dialogSaveFile,
    async (event, req: SaveFileRequest): Promise<string | null> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: req.defaultName }
      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return null
      await writeFile(filePath, req.content, 'utf-8')
      return filePath
    }
  )
}
