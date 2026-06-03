import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiProvider,
  SaveFileRequest,
  ScanProgress,
  ScanResult,
  Settings
} from '../../shared/types'
import { countInvoices, getInvoiceById, insertInvoice, listInvoices } from '../db'
import { getAuthStatus, login, logout } from '../auth'
import { fetchEmails } from '../gmail'
import { toDeterministicInput } from '../gmail/parse'
import { classifyDeterministic } from '../../shared/engines/deterministic'
import { downloadAndRecord, getInvoicesDir } from '../download'
import { isPathInsideDir } from '../lib/pathSafety'
import { selectApproved } from '../scan/classify'
import { classifyWithAI } from '../engines/ai'
import { getProviderConfig } from '../engines/ai/config'
import { getSettings, updateSettings } from '../settings'
import { clearApiKey, getApiKey, hasApiKey, setApiKey } from '../settings/apiKeyStore'
import { isAiProvider } from '../settings/validate'

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

  // --- Settings (REAL — RONY-12, persisted in SQLite) ---
  ipcMain.handle(IpcChannels.settingsGet, (): Settings => getSettings())
  ipcMain.handle(
    IpcChannels.settingsSet,
    (_e, patch: Partial<Settings>): Settings => updateSettings(patch)
  )

  // --- API keys (REAL — RONY-16, encrypted via safeStorage; renderer is write-only) ---
  ipcMain.handle(IpcChannels.settingsSetApiKey, (_e, provider: AiProvider, key: string): void => {
    if (!isAiProvider(provider)) throw new Error('Invalid AI provider.')
    if (typeof key !== 'string') throw new Error('Invalid API key.')
    setApiKey(provider, key)
  })
  ipcMain.handle(IpcChannels.settingsHasApiKey, (_e, provider: AiProvider): boolean =>
    isAiProvider(provider) ? hasApiKey(provider) : false
  )
  ipcMain.handle(IpcChannels.settingsClearApiKey, (_e, provider: AiProvider): void => {
    if (isAiProvider(provider)) clearApiKey(provider)
  })

  // --- Scan pipeline (RONY-7 fetch → RONY-9/RONY-10 classify → RONY-11 download) ---
  // Fetch recent Gmail messages (RONY-7), classify each with the engine the user
  // selected in settings (RONY-9 deterministic OR RONY-10 AI), then download the
  // matched emails' PDF/image attachments and record them in SQLite (RONY-11).
  // Triggered by the RONY-14 "Scan now" button.
  ipcMain.handle(IpcChannels.scanRun, async (event): Promise<ScanResult> => {
    const sendProgress = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.scanProgress, progress)
    }

    // Use the user's persisted engine + provider choice (RONY-12/16).
    const { defaultEngine: engine, aiProvider } = getSettings()

    // Prefer the user's stored key (RONY-16); undefined → the engine falls back
    // to a .env key (dev). Fail fast before fetching if neither is available.
    const aiApiKey = engine === 'ai' ? getApiKey(aiProvider) : undefined
    if (engine === 'ai' && !aiApiKey) getProviderConfig(aiProvider)

    sendProgress({ phase: 'fetching', processed: 0, total: 0, matched: 0, downloaded: 0 })
    const { emails, errors: fetchErrors, firstError: fetchFirstError } = await fetchEmails()

    const {
      approved,
      errors: classifyErrors,
      firstError: classifyFirstError
    } = await selectApproved(
      emails,
      engine,
      {
        deterministic: (email) => classifyDeterministic(toDeterministicInput(email)).isInvoice,
        ai: (email) =>
          classifyWithAI(
            {
              subject: email.subject,
              body: email.bodyText,
              from: email.from,
              filenames: email.attachments.map((a) => a.filename)
            },
            { provider: aiProvider, apiKey: aiApiKey }
          )
      },
      (processed, total, matched) =>
        sendProgress({ phase: 'classifying', processed, total, matched, downloaded: 0 })
    )

    const matched = approved.length
    const download = await downloadAndRecord(approved, (processed, total) =>
      sendProgress({ phase: 'downloading', processed, total, matched, downloaded: processed })
    )

    sendProgress({
      phase: 'done',
      processed: emails.length,
      total: emails.length,
      matched,
      downloaded: download.downloaded
    })
    return {
      scanned: emails.length,
      matched,
      downloaded: download.downloaded,
      errors: fetchErrors + classifyErrors + download.errors,
      errorSample: fetchFirstError ?? classifyFirstError ?? download.firstError
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
