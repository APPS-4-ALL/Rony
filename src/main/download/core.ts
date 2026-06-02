/**
 * RONY-11 — Download manager (pure core).
 *
 * Given emails an engine approved as invoices/receipts, download each in-scope
 * (PDF/image) attachment to a target folder and record it via an injected
 * store. Pure + dependency-injected — NO Electron / network / SQLite imports —
 * so it is fully unit-testable. The real wiring lives in ./index.ts.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
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
  /** Insert a row; return true if inserted, false if a row for this path already exists. */
  insert(invoice: NewInvoice): boolean
}

export interface DownloadDeps {
  /** Absolute folder to write files into (created if missing). */
  targetDir: string
  /** Fetch an attachment's bytes by message + attachment id. */
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>
  store: InvoiceStore
}

export interface DownloadSummary {
  /** Files written + rows recorded (or files restored) this run. */
  downloaded: number
  /** Skipped: already present (file on disk + row), or out of scope, or lost a race. */
  skipped: number
  /** Per-attachment failures (non-fatal — the run continues). */
  errors: number
}

/**
 * Images smaller than this are almost always inline logos/signatures rather
 * than real invoice scans, so we skip them. PDFs download regardless of size.
 */
const MIN_IMAGE_BYTES = 8 * 1024

/** How many attachments to download at once (matches RONY-7's fetch concurrency). */
const DOWNLOAD_CONCURRENCY = 5

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

/** Async file-existence check (non-blocking). */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** One unit of download work, resolved up front. */
interface DownloadTask {
  messageId: string
  attachmentId: string
  filename: string
  targetPath: string
  invoice: NewInvoice
}

/** Run `fn` over `items` with at most `limit` in flight at once. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Download every approved email's in-scope attachments and record each in the
 * store. Robust to:
 *  - same-name attachments in one email — the file name includes the
 *    attachment's index, so neither is silently overwritten/dropped (#1);
 *  - concurrent scans — the store's insert is conflict-safe and counts a lost
 *    race as skipped (#2);
 *  - a file the user deleted from disk — the bytes are re-fetched and rewritten
 *    even though the DB row still exists (#3);
 * and downloads run with bounded concurrency for speed (#4).
 */
export async function downloadApproved(
  approved: ApprovedEmail[],
  deps: DownloadDeps
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, errors: 0 }
  await mkdir(deps.targetDir, { recursive: true })

  // Resolve the work list up front; the index makes each file name unique.
  const tasks: DownloadTask[] = []
  for (const { email, engineType, extracted } of approved) {
    email.attachments.forEach((att, index) => {
      if (!att.attachmentId || !isInScope(att)) {
        summary.skipped++
        return
      }
      const targetPath = join(
        deps.targetDir,
        `${email.id}__${index}__${sanitizeFilename(att.filename)}`
      )
      tasks.push({
        messageId: email.id,
        attachmentId: att.attachmentId,
        filename: att.filename,
        targetPath,
        invoice: {
          messageId: email.id,
          date: extracted?.date ?? email.date,
          vendor: extracted?.vendor ?? null,
          amount: extracted?.amount ?? null,
          currency: extracted?.currency ?? null,
          localFilePath: targetPath,
          status: 'downloaded',
          engineType
        }
      })
    })
  }

  await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY, async (task) => {
    try {
      const recorded = deps.store.existsByPath(task.targetPath)
      // Already recorded AND the file is still on disk → nothing to do.
      if (recorded && (await fileExists(task.targetPath))) {
        summary.skipped++
        return
      }

      const bytes = await deps.fetchAttachment(task.messageId, task.attachmentId)
      await writeFile(task.targetPath, bytes)

      if (recorded) {
        // Row exists but the file was missing — we just restored it; no new row.
        summary.downloaded++
        return
      }
      // New file: record it. A false return means a concurrent scan won the race.
      if (deps.store.insert(task.invoice)) summary.downloaded++
      else summary.skipped++
    } catch (e) {
      summary.errors++
      console.error(`[download] failed for ${task.messageId} / ${task.filename}:`, e)
    }
  })

  return summary
}
