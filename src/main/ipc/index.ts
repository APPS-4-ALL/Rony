import { unlink, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type {
  AiProvider,
  SaveFileRequest,
  ScanProgress,
  ScanResult,
  Settings
} from '../../shared/types'
import { sanitizeScanOptions } from '../scan/options'
import { deleteInvoice, getInvoiceById, listInvoices } from '../db'
import { getAuthStatus, getAuthorizedClient, login, logout } from '../auth'
import { fetchAttachmentData, fetchEmails } from '../gmail'
import { toDeterministicInput } from '../gmail/parse'
import { classifyDeterministic } from '../../shared/engines/deterministic'
import { downloadAndRecord, getEffectiveInvoicesDir, getInvoicesDir } from '../download'
import { isPathInsideDir } from '../lib/pathSafety'
import { selectApproved } from '../scan/classify'
import { classifyWithAI } from '../engines/ai'
import type { AiAttachment } from '../engines/ai/types'
import { pickInvoiceAttachment, visionMimeType } from '../engines/ai/attachments'
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
  // --- Invoices (real, backed by SQLite) ---
  ipcMain.handle(IpcChannels.invoicesList, () => listInvoices())
  // Open a downloaded invoice with the OS default app (RONY-13 "Open file").
  //
  // SECURITY: the renderer is untrusted, so it sends only the invoice ID — NOT
  // a path. We look the path up in SQLite ourselves and verify it resolves
  // inside the authorized invoices folder before handing it to the OS. This
  // prevents a compromised/XSS'd renderer from opening arbitrary system files.
  // Returns '' on success (matching shell.openPath) or a readable error.
  ipcMain.handle(IpcChannels.invoicesOpenFile, async (_e, invoiceId: number): Promise<string> => {
    if (typeof invoiceId !== 'number' || !Number.isInteger(invoiceId)) {
      return 'מזהה חשבונית לא תקין.'
    }
    const invoice = getInvoiceById(invoiceId)
    if (!invoice) return 'החשבונית לא נמצאה.'
    if (!invoice.localFilePath) return 'אין קובץ המשויך לחשבונית זו עדיין.'

    // Containment check: the stored path MUST live inside an invoices folder we
    // control — the user's current download folder OR the default (older files
    // saved before the folder was changed still resolve under the default).
    const allowedDirs = [getEffectiveInvoicesDir(), getInvoicesDir()]
    if (!allowedDirs.some((dir) => isPathInsideDir(dir, invoice.localFilePath!))) {
      console.error(
        `[security] refused to open out-of-bounds path for invoice ${invoiceId}: ${invoice.localFilePath}`
      )
      return 'הקובץ נמצא מחוץ לתיקיית החשבוניות — הפתיחה נחסמה.'
    }

    return shell.openPath(invoice.localFilePath)
  })

  // Delete an invoice: remove its downloaded file from disk AND its DB row.
  //
  // SECURITY: like openFile, the renderer sends only the ID. We look up the
  // path ourselves and only unlink it when it resolves INSIDE an invoices folder
  // we control — never an arbitrary path.
  //
  // CONSISTENCY: we delete the FILE first and the row only if that succeeds (or
  // the file was already gone). If the file is locked — usually because it's open
  // in another program on Windows (EBUSY/EPERM) — we abort and keep the row, so
  // the user never ends up with an orphaned file the app no longer tracks.
  // Returns '' on success, or a readable error.
  ipcMain.handle(IpcChannels.invoicesDelete, async (_e, invoiceId: number): Promise<string> => {
    if (typeof invoiceId !== 'number' || !Number.isInteger(invoiceId)) {
      return 'מזהה חשבונית לא תקין.'
    }
    const invoice = getInvoiceById(invoiceId)
    if (!invoice) return 'החשבונית לא נמצאה.'

    if (invoice.localFilePath) {
      const allowedDirs = [getEffectiveInvoicesDir(), getInvoicesDir()]
      if (allowedDirs.some((dir) => isPathInsideDir(dir, invoice.localFilePath!))) {
        try {
          await unlink(invoice.localFilePath)
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          // Anything but "already gone" means we could NOT remove the file →
          // keep the row so file + DB stay consistent, and tell the user why.
          if (code !== 'ENOENT') {
            console.error(`[delete] failed to remove file for invoice ${invoiceId}:`, e)
            if (code === 'EBUSY' || code === 'EPERM') {
              return 'לא ניתן למחוק — הקובץ כנראה פתוח בתוכנה אחרת. סגור/י אותו ונסה/י שוב.'
            }
            return `מחיקת הקובץ נכשלה: ${e instanceof Error ? e.message : String(e)}`
          }
        }
      } else {
        console.error(
          `[security] refused to delete out-of-bounds file for invoice ${invoiceId}: ${invoice.localFilePath}`
        )
      }
    }

    deleteInvoice(invoiceId)
    return ''
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
  ipcMain.handle(IpcChannels.scanRun, async (event, rawOpts: unknown): Promise<ScanResult> => {
    const sendProgress = (progress: ScanProgress): void => {
      if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.scanProgress, progress)
    }

    // Use the user's persisted engine + provider choice (RONY-12/16).
    const { defaultEngine: engine, aiProvider, aiConsent } = getSettings()

    // PRIVACY GATE (defense in depth): the AI engine sends email text +
    // attachments to a third-party provider, so it must NOT run without the
    // user's explicit opt-in. The UI gates this behind a consent dialog, but the
    // renderer is untrusted — we re-check here so a bypassed/compromised UI can
    // never trigger an AI scan. Deterministic scans are fully local and exempt.
    if (engine === 'ai' && !aiConsent) {
      throw new Error('סריקת AI דורשת אישור שליחת תוכן המיילים לספק חיצוני. אשר/י זאת בהגדרות.')
    }

    // Prefer the user's stored key (RONY-16); undefined → the engine falls back
    // to a .env key (dev). Fail fast before fetching if neither is available.
    const aiApiKey = engine === 'ai' ? getApiKey(aiProvider) : undefined
    if (engine === 'ai' && !aiApiKey) getProviderConfig(aiProvider)

    // Per-run controls from the UI (count + date range), validated here since
    // the renderer is untrusted; invalid fields fall back to engine defaults.
    sendProgress({ phase: 'fetching', processed: 0, total: 0, matched: 0, downloaded: 0 })
    const {
      emails,
      errors: fetchErrors,
      firstError: fetchFirstError
    } = await fetchEmails(sanitizeScanOptions(rawOpts))

    // RONY-10 tiered scan: the AI engine first classifies each email on the FAST
    // model using text only, then escalates to the STRONG document-reading model
    // ONLY when that pass needs the file (e.g. the total amount lives inside the
    // PDF/image). `loadVisionAttachment` is therefore lazy — it downloads ONE
    // representative attachment, but only when the engine actually asks for it.
    // Any fetch failure leaves the fast result in place (never fatal).
    const client = getAuthorizedClient()
    const loadVisionAttachment = async (
      email: (typeof emails)[number]
    ): Promise<AiAttachment[] | undefined> => {
      if (!client) return undefined
      const chosen = pickInvoiceAttachment(email.attachments)
      if (!chosen?.attachmentId) return undefined
      try {
        const data = await fetchAttachmentData(client, email.id, chosen.attachmentId)
        // Send the corrected MIME (a sender may mislabel a PDF as octet-stream).
        const mimeType = visionMimeType(chosen) ?? chosen.mimeType
        return [{ filename: chosen.filename, mimeType, data }]
      } catch (e) {
        console.error(`[scan] vision attachment fetch failed for ${email.id} (text-only):`, e)
        return undefined
      }
    }

    const {
      approved,
      errors: classifyErrors,
      firstError: classifyFirstError
    } = await selectApproved(
      emails,
      engine,
      {
        deterministic: (email) => classifyDeterministic(toDeterministicInput(email)).isInvoice,
        ai: async (email) =>
          classifyWithAI(
            {
              subject: email.subject,
              body: email.bodyText,
              from: email.from,
              filenames: email.attachments.map((a) => a.filename)
            },
            {
              provider: aiProvider,
              apiKey: aiApiKey,
              loadAttachments: () => loadVisionAttachment(email)
            }
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
      rejected: download.rejected,
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

  // Pick a folder for saved invoice downloads (optional custom download dir).
  ipcMain.handle(IpcChannels.dialogPickFolder, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })
}
