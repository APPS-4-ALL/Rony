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
import { invoiceExistsByPath, tryInsertInvoice } from '../db'
import { downloadApproved, type ApprovedEmail, type DownloadSummary } from './core'

/**
 * Local folder invoices are saved to: `Documents/Rony Invoices`.
 * Pure path utility — the download core creates the folder asynchronously
 * (`mkdir … { recursive: true }`), so we don't block the main thread here.
 */
export function getInvoicesDir(): string {
  return join(app.getPath('documents'), 'Rony Invoices')
}

/**
 * Download the in-scope attachments of engine-approved emails into the local
 * invoices folder and record each in SQLite. Throws `NotConnectedError` if no
 * Gmail account is connected.
 */
export async function downloadAndRecord(approved: ApprovedEmail[]): Promise<DownloadSummary> {
  const client = getAuthorizedClient()
  if (!client) throw new NotConnectedError()

  return downloadApproved(approved, {
    targetDir: getInvoicesDir(),
    fetchAttachment: (messageId, attachmentId) =>
      fetchAttachmentData(client, messageId, attachmentId),
    store: { existsByPath: invoiceExistsByPath, insert: tryInsertInvoice }
  })
}

export type { ApprovedEmail, DownloadSummary } from './core'
