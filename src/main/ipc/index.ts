import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { SaveFileRequest, ScanResult, Settings } from '../../shared/types'
import { countInvoices, getInvoiceById, insertInvoice, listInvoices } from '../db'
import { getAuthStatus, login, logout } from '../auth'
import { fetchEmails } from '../gmail'
import { toDeterministicInput } from '../gmail/parse'
import { classifyDeterministic } from '../../shared/engines/deterministic'
import { downloadAndRecord, getInvoicesDir, type ApprovedEmail } from '../download'
import { isPathInsideDir } from '../lib/pathSafety'

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
  //
  // SECURITY: the renderer is untrusted, so it sends only the invoice ID — NOT
  // a path. We look the path up in SQLite ourselves and verify it resolves
  // inside the authorized invoices folder before handing it to the OS. This
  // prevents a compromised/XSS'd renderer from opening arbitrary system files.
  // Returns '' on success (matching shell.openPath) or a readable error.
  ipcMain.handle(IpcChannels.invoicesOpenFile, async (_e, invoiceId: number): Promise<string> => {
    if (typeof invoiceId !== 'number' || !Number.isInteger(invoiceId)) {
      return 'Invalid invoice id.'
    }
    const invoice = getInvoiceById(invoiceId)
    if (!invoice) return 'Invoice not found.'
    if (!invoice.localFilePath) return 'No file is associated with this invoice yet.'

    // Containment check: the stored path MUST live inside Documents/Rony Invoices.
    if (!isPathInsideDir(getInvoicesDir(), invoice.localFilePath)) {
      console.error(
        `[security] refused to open out-of-bounds path for invoice ${invoiceId}: ${invoice.localFilePath}`
      )
      return 'Refused to open a file outside the invoices folder.'
    }

    return shell.openPath(invoice.localFilePath)
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
