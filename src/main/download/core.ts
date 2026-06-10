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
import { isInvoiceDocument, type GmailAttachmentRef, type ParsedEmail } from '../gmail/parse'
import { cleanReceiptBody } from '../pdf/cleanBody'
import { validateContent, type ValidationResult } from './validate'
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
  /** True if a row already exists for this Gmail message id (body-only dedup). */
  existsByMessageId(messageId: string): boolean
  /** Insert a row; return true if inserted, false if a row for this path already exists. */
  insert(invoice: NewInvoice): boolean
}

export interface DownloadDeps {
  /** Absolute folder to write files into (created if missing). */
  targetDir: string
  /** Fetch an attachment's bytes by message + attachment id. */
  fetchAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>
  /**
   * Render a body-only receipt's content into PDF bytes (Electron printToPDF).
   * Optional + injected so the core stays pure/testable; when absent we fall
   * back to a file-less row that keeps the email body for in-app viewing.
   */
  renderEmailPdf?: (data: {
    vendor: string | null
    subject: string | null
    amount: number | null
    currency: string | null
    date: string | null
    body: string
  }) => Promise<Buffer>
  /**
   * RONY-17: validate a freshly downloaded document's bytes before we record it,
   * filtering out error pages / truncated / mistyped files. Optional + injected
   * so the pure core stays decoupled and testable; when absent, every fetched
   * file is accepted (the historical behaviour). The real impl is
   * {@link validateDocument} in ./validate.ts, wired in ./index.ts.
   */
  validateDocument?: (doc: {
    filename: string
    mimeType: string
    bytes: Buffer
  }) => ValidationResult
  /**
   * RONY-17 content check: extract the TEXT inside a downloaded document so we
   * can confirm it actually reads like an invoice/receipt — not just a
   * structurally-valid file of something else. Returns the extracted text, or
   * `null` when text can't be obtained (an image with no text layer, an
   * encrypted/garbled PDF, an unsupported type, or an extraction error), in
   * which case the content check is SKIPPED rather than failed. Deterministic
   * and offline (NO AI). Optional + injected so the core stays pure/testable;
   * the real impl lives in ./index.ts.
   */
  extractDocumentText?: (doc: {
    filename: string
    mimeType: string
    bytes: Buffer
  }) => Promise<string | null>
  store: InvoiceStore
}

export interface DownloadSummary {
  /** Files written + rows recorded (or files restored) this run. */
  downloaded: number
  /** Skipped: already present (file on disk + row), or out of scope, or lost a race. */
  skipped: number
  /**
   * RONY-17: fetched files that FAILED document validation (an HTML error page,
   * a truncated/empty download, or a mistyped binary) and so were NOT recorded.
   * Distinct from `errors` — these aren't failures, they're deliberately filtered.
   */
  rejected: number
  /** Per-attachment failures (non-fatal — the run continues). */
  errors: number
  /** A representative error message (the first failure), for the UI. */
  firstError?: string
}

/**
 * Images smaller than this are almost always inline logos/signatures rather
 * than real invoice scans, so we skip them. PDFs download regardless of size.
 */
const MIN_IMAGE_BYTES = 8 * 1024

/** How many attachments to download at once (matches RONY-7's fetch concurrency). */
const DOWNLOAD_CONCURRENCY = 5

/** How many body-only PDFs to render at once — each is a real offscreen window. */
const BODY_PDF_CONCURRENCY = 3

/**
 * Body cap for the GENERATED PDF — generous, since that text IS the document
 * (the in-app popup uses cleanReceiptBody's smaller default).
 */
const PDF_BODY_MAX_LENGTH = 20000

/** Make a Gmail filename safe to use as a local file name. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_') // characters illegal in file names on Windows/Unix
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : 'attachment'
}

/**
 * Type/size gate for a downloadable invoice document: a PDF / office doc of any
 * size, or an image large enough not to be a logo/signature.
 */
function isInScope(att: GmailAttachmentRef): boolean {
  if (!isInvoiceDocument(att)) return false
  const isImage = att.mimeType.toLowerCase().startsWith('image/')
  // Inline images are signature/logo art embedded in the body via `cid:` — never
  // the invoice itself — so skip them regardless of size (logos can exceed the
  // size gate below). PDFs are kept even if inline (a real document either way).
  if (isImage && att.inline) return false
  if (isImage && att.size > 0 && att.size < MIN_IMAGE_BYTES) return false
  return true
}

/**
 * Build the invoice row for an approved email (AI-extracted fields win over the
 * fallbacks). A null `localFilePath` is a body-only receipt — the invoice lives
 * in the email text, with no file to download.
 */
function buildInvoice(
  email: ParsedEmail,
  engineType: EngineType,
  extracted: ExtractedFields | undefined,
  localFilePath: string | null,
  generated = false
): NewInvoice {
  return {
    messageId: email.id,
    date: extracted?.date ?? email.date,
    // 'document' only when the AI actually extracted a date; else the email's date.
    dateSource: extracted?.date ? 'document' : 'email',
    vendor: extracted?.vendor ?? null,
    amount: extracted?.amount ?? null,
    currency: extracted?.currency ?? null,
    localFilePath,
    // Keep the body only when there's no file (the fallback path) so the user
    // can still view it; once a (generated) PDF exists, the body is in it. We
    // clean the reply-thread/signature noise either way (see cleanReceiptBody).
    emailBody: localFilePath ? null : cleanReceiptBody(email.bodyText),
    generated,
    status: 'downloaded',
    engineType
  }
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
  /** The attachment's MIME type — a hint for RONY-17 document validation. */
  mimeType: string
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
  deps: DownloadDeps,
  onProgress?: (processed: number, total: number) => void
): Promise<DownloadSummary> {
  const summary: DownloadSummary = { downloaded: 0, skipped: 0, rejected: 0, errors: 0 }
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
        mimeType: att.mimeType,
        targetPath,
        invoice: buildInvoice(email, engineType, extracted, targetPath)
      })
    })
  }

  let processed = 0
  await runWithConcurrency(tasks, DOWNLOAD_CONCURRENCY, async (task) => {
    try {
      const recorded = deps.store.existsByPath(task.targetPath)
      // Already recorded AND the file is still on disk → nothing to do.
      if (recorded && (await fileExists(task.targetPath))) {
        summary.skipped++
        return
      }

      const bytes = await deps.fetchAttachment(task.messageId, task.attachmentId)

      // RONY-17: validate NEW downloads before persisting — drop HTML error
      // pages, truncated/empty files, and mistyped binaries so they never get
      // recorded as invoices. A restore (`recorded`) was already validated when
      // first saved, so we don't re-judge it (and never strand a DB row).
      if (!recorded && deps.validateDocument) {
        const verdict = deps.validateDocument({
          filename: task.filename,
          mimeType: task.mimeType,
          bytes
        })
        if (!verdict.valid) {
          summary.rejected++
          console.warn(
            `[validate] rejected ${task.filename} (${task.messageId}): ${verdict.reason}`
          )
          return
        }
      }

      // RONY-17 content gate: confirm the document's TEXT reads like an
      // invoice/receipt. Conservative — only a clear mismatch (text extracted,
      // zero keywords) rejects; images / unreadable / extraction-error docs are
      // skipped (never dropped on content). Runs for BOTH engines.
      if (!recorded && deps.extractDocumentText) {
        let text: string | null = null
        try {
          text = await deps.extractDocumentText({
            filename: task.filename,
            mimeType: task.mimeType,
            bytes
          })
        } catch (e) {
          console.warn(
            `[validate] text extraction failed for ${task.filename} (${task.messageId}) — skipping content check:`,
            e
          )
        }
        const content = validateContent(text)
        if (content.skipped) {
          console.info(
            `[validate] content check skipped for ${task.filename} (no extractable text)`
          )
        } else if (!content.valid) {
          summary.rejected++
          console.warn(
            `[validate] rejected ${task.filename} (${task.messageId}): ${content.reason}`
          )
          return
        }
      }

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
      summary.firstError ??= e instanceof Error ? e.message : String(e)
      console.error(`[download] failed for ${task.messageId} / ${task.filename}:`, e)
    } finally {
      onProgress?.(++processed, tasks.length)
    }
  })

  // Body-only receipts: approved emails with NO in-scope attachment are real
  // invoices printed in the email body. We turn each into a generated PDF so it
  // becomes a first-class, openable/exportable file; if PDF rendering isn't
  // available (or fails), we fall back to a file-less row that keeps the body.
  // Deduped by message id (there's no original file path to key on).
  //
  // SMART-SCAN ONLY: this is an AI-engine feature. The deterministic engine is a
  // coarse keyword match with no extracted fields, so a body-only match there
  // would produce a near-empty row (no vendor/amount) from possibly-incidental
  // keywords (e.g. "קבלה" also means "reception"). We therefore record body-only
  // receipts only when the AI judged the email financial.
  const bodyOnly = approved.filter(
    ({ email, engineType }) =>
      engineType === 'ai' && !email.attachments.some((a) => a.attachmentId && isInScope(a))
  )
  await runWithConcurrency(
    bodyOnly,
    BODY_PDF_CONCURRENCY,
    async ({ email, engineType, extracted }) => {
      if (deps.store.existsByMessageId(email.id)) {
        summary.skipped++
        return
      }

      let invoice = buildInvoice(email, engineType, extracted, null) // fallback (file-less)
      if (deps.renderEmailPdf) {
        try {
          const pdf = await deps.renderEmailPdf({
            vendor: extracted?.vendor ?? null,
            subject: email.subject,
            amount: extracted?.amount ?? null,
            currency: extracted?.currency ?? null,
            date: extracted?.date ?? email.date,
            body: cleanReceiptBody(email.bodyText, PDF_BODY_MAX_LENGTH)
          })
          const targetPath = join(deps.targetDir, `${email.id}__email.pdf`)
          await writeFile(targetPath, pdf)
          invoice = buildInvoice(email, engineType, extracted, targetPath, true)
        } catch (e) {
          summary.firstError ??= e instanceof Error ? e.message : String(e)
          console.error(`[pdf] generation failed for ${email.id} (keeping body-only):`, e)
        }
      }

      if (deps.store.insert(invoice)) summary.downloaded++
      else summary.skipped++
    }
  )

  return summary
}
