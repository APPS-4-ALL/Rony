/**
 * RONY-11 — Download manager (pure core).
 *
 * Given emails an engine approved as invoices/receipts, download each in-scope
 * (PDF/image) attachment to a target folder and record it via an injected
 * store. Pure + dependency-injected — NO Electron / network / SQLite imports —
 * so it is fully unit-testable. The real wiring lives in ./index.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPdfOrImage, type GmailAttachmentRef, type ParsedEmail } from '../gmail/parse'
import type { EngineType, NewInvoice } from '../../shared/types'

/** Extracted invoice fields. The AI engine fills these; the deterministic engine leaves them null. */
export interface ExtractedFields {
  vendor?: string | null
  amount?: number | null
  currency?: string | null
  date?: string | null
}

/** One email an engine flagged as an invoice/receipt, to be downloaded. */
export interface ApprovedEmail {
  email: ParsedEmail
  /** Which engine approved it — stored on the row so we know its provenance. */
  engineType: EngineType
  /** Optional extracted metadata (from the AI engine). */
  extracted?: ExtractedFields
}

/** Minimal persistence surface — the real impl wraps SQLite; tests inject a fake. */
export interface InvoiceStore {
  existsByPath(localFilePath: string): boolean
  insert(invoice: NewInvoice): void
}

export interface DownloadDeps {
  /** Absolute folder to write files into (created if missing). */
  targetDir: string
  /** Fetch an attachment's bytes by message + attachment id. */
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>
  store: InvoiceStore
}

export interface DownloadSummary {
  /** Files saved + rows inserted this run. */
  downloaded: number
  /** Skipped: already recorded (dedup), or out of scope (no id / too small / wrong type). */
  skipped: number
  /** Per-attachment failures (non-fatal — the run continues). */
  errors: number
}

/**
 * Images smaller than this are almost always inline logos/signatures rather
 * than real invoice scans, so we skip them. PDFs download regardless of size.
 */
const MIN_IMAGE_BYTES = 8 * 1024

/** Make a Gmail filename safe to use as a local file name. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_') // characters illegal in file names on Windows/Unix
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : 'attachment'
}

/** Type/size gate: a real PDF, or an image large enough not to be a logo. */
function isInScope(att: GmailAttachmentRef): boolean {
  if (!isPdfOrImage(att)) return false
  const isImage = att.mimeType.toLowerCase().startsWith('image/')
  if (isImage && att.size > 0 && att.size < MIN_IMAGE_BYTES) return false
  return true
}

/**
 * Download every approved email's in-scope attachments and record each in the
 * store. Idempotent: an attachment already recorded (same target path) is
 * skipped, so re-running a scan doesn't duplicate files or rows.
 */
export async function downloadApproved(
  approved: ApprovedEmail[],
  deps: DownloadDeps
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, errors: 0 }
  await mkdir(deps.targetDir, { recursive: true })

  for (const { email, engineType, extracted } of approved) {
    for (const att of email.attachments) {
      const { attachmentId } = att
      // Skip inline data (no fetchable id) and out-of-scope/tiny attachments.
      if (!attachmentId || !isInScope(att)) {
        summary.skipped++
        continue
      }

      const targetPath = join(deps.targetDir, `${email.id}__${sanitizeFilename(att.filename)}`)

      // Dedup: don't re-download something already recorded.
      if (deps.store.existsByPath(targetPath)) {
        summary.skipped++
        continue
      }

      try {
        const bytes = await deps.fetchAttachment(email.id, attachmentId)
        await writeFile(targetPath, bytes)
        deps.store.insert({
          messageId: email.id,
          date: extracted?.date ?? email.date,
          vendor: extracted?.vendor ?? null,
          amount: extracted?.amount ?? null,
          currency: extracted?.currency ?? null,
          localFilePath: targetPath,
          status: 'downloaded',
          engineType
        })
        summary.downloaded++
      } catch (e) {
        summary.errors++
        console.error(`[download] failed for ${email.id} / ${att.filename}:`, e)
      }
    }
  }

  return summary
}
