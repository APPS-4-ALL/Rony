/**
 * RONY-11 — Download manager wiring.
 *
 * Binds the pure core in ./core.ts to the real folder (Electron Documents),
 * the Gmail attachment fetch (RONY-7), and the SQLite store (RONY-3). Used by
 * the scan pipeline (`scan:run`).
 */
import { join } from 'node:path'
import { app } from 'electron'
import { getAuthorizedClient } from '../auth'
import { fetchAttachmentData, NotConnectedError } from '../gmail'
import { invoiceExistsByMessageId, invoiceExistsByPath, tryInsertInvoice } from '../db'
import { getSettings } from '../settings'
import { renderEmailPdf } from '../pdf'
import { downloadApproved, type ApprovedEmail, type DownloadSummary } from './core'
import { validateDocument } from './validate'
import { extractDocumentText } from './extractText'
import { createSafeHttpGet, fetchLinkDocument } from './linkFetch'
import { ocrDocument } from './ocr'

/** One shared, hardened HTTP transport for all link-following (RONY-18). */
const safeHttpGet = createSafeHttpGet()

/**
 * Default folder invoices are saved to: `Documents/Rony Invoices`.
 * Pure path utility — the download core creates the folder asynchronously
 * (`mkdir … { recursive: true }`), so we don't block the main thread here.
 */
export function getInvoicesDir(): string {
  return join(app.getPath('documents'), 'Rony Invoices')
}

/**
 * The folder invoices actually save to: the user's chosen `downloadDir`
 * (Settings) if set, otherwise the default {@link getInvoicesDir}.
 */
export function getEffectiveInvoicesDir(): string {
  return getSettings().downloadDir ?? getInvoicesDir()
}

/**
 * Download the in-scope attachments of engine-approved emails into the local
 * invoices folder and record each in SQLite. Throws `NotConnectedError` if no
 * Gmail account is connected.
 */
export async function downloadAndRecord(
  approved: ApprovedEmail[],
  onProgress?: (processed: number, total: number) => void
): Promise<DownloadSummary> {
  const client = getAuthorizedClient()
  if (!client) throw new NotConnectedError()

  // RONY-18: only wire the link follower when the user opted in (`followLinks`),
  // so Rony never reaches out to vendor URLs without explicit consent.
  const { followLinks } = getSettings()

  return downloadApproved(
    approved,
    {
      targetDir: getEffectiveInvoicesDir(),
      fetchAttachment: (messageId, attachmentId) =>
        fetchAttachmentData(client, messageId, attachmentId),
      renderEmailPdf,
      validateDocument,
      extractDocumentText,
      ocrDocument,
      ...(followLinks
        ? { fetchLinkDocument: (links) => fetchLinkDocument(links, safeHttpGet) }
        : {}),
      store: {
        existsByPath: invoiceExistsByPath,
        existsByMessageId: invoiceExistsByMessageId,
        insert: tryInsertInvoice
      }
    },
    onProgress
  )
}

export type { ApprovedEmail, DownloadSummary } from './core'
