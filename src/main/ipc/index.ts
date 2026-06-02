import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { SaveFileRequest, ScanResult, Settings } from '../../shared/types'
import { countInvoices, insertInvoice, listInvoices } from '../db'
import { getAuthStatus, login, logout } from '../auth'
import { fetchEmails } from '../gmail'
import { toDeterministicInput } from '../gmail/parse'
import { classifyDeterministic } from '../../shared/engines/deterministic'
import { downloadAndRecord, type ApprovedEmail } from '../download'

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
  // Open a downloaded invoice with the OS default app (RONY-13 "Open file").
  // shell.openPath returns '' on success or an error string on failure.
  ipcMain.handle(IpcChannels.invoicesOpenFile, (_e, path: string) => {
    if (!path) return Promise.resolve('No file is associated with this invoice yet.')
    return shell.openPath(path)
  })

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

  // --- Scan pipeline (RONY-7 fetch + RONY-9 classify + RONY-11 download) ---
  // Fetch recent Gmail messages (RONY-7), classify each with the deterministic
  // engine (RONY-9), then download the matched emails' PDF/image attachments to
  // the local folder and record them in SQLite (RONY-11). Wiring the AI engine
  // (RONY-10) into this path is a later round.
  ipcMain.handle(IpcChannels.scanRun, async (): Promise<ScanResult> => {
    const { emails, errors } = await fetchEmails()

    const approved: ApprovedEmail[] = []
    for (const email of emails) {
      if (classifyDeterministic(toDeterministicInput(email)).isInvoice) {
        approved.push({ email, engineType: 'deterministic' })
      }
    }

    const download = await downloadAndRecord(approved)
    return {
      scanned: emails.length,
      matched: approved.length,
      downloaded: download.downloaded,
      errors: errors + download.errors
    }
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
