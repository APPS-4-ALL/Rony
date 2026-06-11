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
import { createHash } from 'node:crypto'
import {
  isInlineImageName,
  isInvoiceDocument,
  type GmailAttachmentRef,
  type ParsedEmail
} from '../gmail/parse'
import { cleanReceiptBody } from '../pdf/cleanBody'
import { validateContent, type ValidationResult } from './validate'
import { selectInvoiceLinks, type EmailLink } from '../gmail/links'
import type { FetchedDocument } from './linkFetch'
import { extractInvoiceFields } from '../../shared/engines/extract'
import { logger, maskFile, maskId } from '../lib/log'
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
  /**
   * RONY-18: download an invoice that's behind a LINK rather than attached.
   * Given the email's ranked candidate links, follows them (redirects + a single
   * HTML-scrape hop) and returns the fetched document, or null if none yields one.
   * Optional + injected; when ABSENT, link-following is OFF (the default, and the
   * opt-in `followLinks` setting is how ./index.ts decides to wire it in). The
   * real network/security impl lives in ./linkFetch.ts.
   */
  fetchLinkDocument?: (links: EmailLink[]) => Promise<FetchedDocument | null>
  /**
   * OCR fallback for the DETERMINISTIC field extraction only: when a document has
   * no text layer (a scan / photo / image-only PDF), {@link extractDocumentText}
   * returns nothing, so we OCR it to still read vendor + total. Deliberately NOT
   * used by the content gate (OCR is noisy — it must never reject a document).
   * Optional + injected so the core stays pure/testable; the real impl is in
   * ./ocr.ts, wired in ./index.ts.
   */
  ocrDocument?: (doc: {
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

/** How many invoice links to follow at once (each is a network round-trip). */
const LINK_CONCURRENCY = 3

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
  // Outlook/Exchange auto-named embedded images (image001.png, …) are signature
  // logos, not invoices — skip them even when they arrive without the inline flag
  // (and regardless of MIME, in case a sender mislabels the part).
  if (isInlineImageName(att.filename)) return false
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

  /**
   * RONY-17 gates for a NEW document (file-type + content). Returns `ok: false`
   * and counts a rejection when it fails; logs skips. Also returns the text it
   * extracted, so callers (the deterministic field extraction) can reuse it
   * without reading the file twice. Shared by the attachment and RONY-18 link
   * paths so both validate identically.
   */
  const passesValidation = async (
    filename: string,
    mimeType: string,
    bytes: Buffer
  ): Promise<{ ok: boolean; text: string | null }> => {
    if (deps.validateDocument) {
      const verdict = deps.validateDocument({ filename, mimeType, bytes })
      if (!verdict.valid) {
        summary.rejected++
        logger.warn(`[validate] rejected ${maskFile(filename)}: ${verdict.reason}`)
        return { ok: false, text: null }
      }
    }
    let text: string | null = null
    if (deps.extractDocumentText) {
      try {
        text = await deps.extractDocumentText({ filename, mimeType, bytes })
      } catch (e) {
        logger.warn(
          `[validate] text extraction failed for ${maskFile(filename)} — skipping content check:`,
          e
        )
      }
      const content = validateContent(text)
      if (content.skipped) {
        logger.info(
          `[validate] content check skipped for ${maskFile(filename)} (no extractable text)`
        )
      } else if (!content.valid) {
        summary.rejected++
        logger.warn(`[validate] rejected ${maskFile(filename)}: ${content.reason}`)
        return { ok: false, text }
      }
    }
    return { ok: true, text }
  }

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
      // pages, truncated/empty files, mistyped binaries, and non-invoice content
      // so they never get recorded. A restore (`recorded`) was already validated
      // when first saved, so we don't re-judge it (and never strand a DB row).
      // We keep the extracted text: the deterministic engine reuses it below to
      // pull vendor + total, so we extract once and feed two consumers.
      let documentText: string | null = null
      if (!recorded) {
        const verdict = await passesValidation(task.filename, task.mimeType, bytes)
        if (!verdict.ok) return
        documentText = verdict.text
      }

      await writeFile(task.targetPath, bytes)

      if (recorded) {
        // Row exists but the file was missing — we just restored it; no new row.
        summary.downloaded++
        return
      }

      // Deterministic field extraction: the keyword engine records no
      // vendor/amount on its own, so we pull the supplier name + grand total off
      // the document text with regex (see extractInvoiceFields). The AI engine
      // already supplies these on `task.invoice`, so we only fill the
      // deterministic gap. We prefer the native text layer; when it is blank (a
      // scan / photo / image-only PDF) we fall back to OCR. If both come up
      // empty the fields stay null — visibly flagged for review.
      let invoice = task.invoice
      if (invoice.engineType === 'deterministic') {
        let text = documentText
        if ((!text || !text.trim()) && deps.ocrDocument) {
          try {
            text = await deps.ocrDocument({
              filename: task.filename,
              mimeType: task.mimeType,
              bytes
            })
          } catch (e) {
            logger.warn(
              `[ocr] extraction failed for ${maskFile(task.filename)} (${maskId(task.messageId)}):`,
              e
            )
          }
        }
        if (text && text.trim()) {
          const fields = extractInvoiceFields(text)
          invoice = {
            ...invoice,
            vendor: fields.vendor,
            amount: fields.amount,
            currency: fields.currency
          }
        }
      }
      // New file: record it. A false return means a concurrent scan won the race.
      if (deps.store.insert(invoice)) summary.downloaded++
      else summary.skipped++
    } catch (e) {
      summary.errors++
      summary.firstError ??= e instanceof Error ? e.message : String(e)
      logger.error(
        `[download] failed for ${maskId(task.messageId)} / ${maskFile(task.filename)}:`,
        e
      )
    } finally {
      onProgress?.(++processed, tasks.length)
    }
  })

  // RONY-18 — invoices behind a DOWNLOAD LINK (not attached). For approved
  // emails with no in-scope attachment, follow the best invoice link and fetch
  // the document (redirects + one HTML-scrape hop, all in the hardened fetcher).
  // Gated by the injected `fetchLinkDocument` (the opt-in `followLinks` setting),
  // runs for BOTH engines, and validates the result via the SAME RONY-17 gates.
  // Deduped by message id; emails that yield a document are skipped by body-only.
  const linkRecorded = new Set<string>()
  if (deps.fetchLinkDocument) {
    const noAttachment = approved.filter(
      ({ email }) => !email.attachments.some((a) => a.attachmentId && isInScope(a))
    )
    await runWithConcurrency(
      noAttachment,
      LINK_CONCURRENCY,
      async ({ email, engineType, extracted }) => {
        if (deps.store.existsByMessageId(email.id)) {
          summary.skipped++
          linkRecorded.add(email.id) // already have a row — keep body-only off it
          return
        }
        const candidates = selectInvoiceLinks(email.links)
        if (candidates.length === 0) return

        let doc: FetchedDocument | null = null
        try {
          doc = await deps.fetchLinkDocument!(candidates)
        } catch (e) {
          summary.errors++
          summary.firstError ??= e instanceof Error ? e.message : String(e)
          logger.error(`[link] download failed for ${maskId(email.id)}:`, e)
          return
        }
        if (!doc) return // no link produced a document — fall through to body-only

        const verdict = await passesValidation(doc.filename, doc.mimeType, doc.bytes)
        if (!verdict.ok) return

        // Dedup by the DOCUMENT's CONTENT, not the email: vendors put the same
        // invoice link in every message of a thread, so the identical file arrives
        // from several message ids. Hashing the bytes into the path makes
        // existsByPath catch it — one row per document, not per email.
        const hash = createHash('sha256').update(doc.bytes).digest('hex').slice(0, 16)
        const targetPath = join(deps.targetDir, `${hash}__link__${sanitizeFilename(doc.filename)}`)
        if (deps.store.existsByPath(targetPath)) {
          summary.skipped++
          linkRecorded.add(email.id)
          return
        }

        // The AI can't read a LINKED document (there's no attachment to send to
        // vision), so the vendor/total usually live ONLY in this file. Mine it for
        // any field the engine left empty — native text first, OCR as fallback.
        let text = verdict.text
        if ((!text || !text.trim()) && deps.ocrDocument) {
          try {
            text = await deps.ocrDocument({
              filename: doc.filename,
              mimeType: doc.mimeType,
              bytes: doc.bytes
            })
          } catch (e) {
            logger.warn(`[ocr] link document OCR failed for ${maskId(email.id)}:`, e)
          }
        }
        const fields: ExtractedFields = { ...extracted }
        if (text && text.trim()) {
          const parsed = extractInvoiceFields(text)
          fields.vendor ??= parsed.vendor
          fields.amount ??= parsed.amount
          fields.currency ??= parsed.currency
        }

        try {
          await writeFile(targetPath, doc.bytes)
        } catch (e) {
          summary.errors++
          summary.firstError ??= e instanceof Error ? e.message : String(e)
          logger.error(
            `[link] failed to save ${maskFile(doc.filename)} for ${maskId(email.id)}:`,
            e
          )
          return
        }
        if (deps.store.insert(buildInvoice(email, engineType, fields, targetPath))) {
          summary.downloaded++
          linkRecorded.add(email.id)
        } else {
          summary.skipped++
        }
      }
    )
  }

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
      engineType === 'ai' &&
      !linkRecorded.has(email.id) && // RONY-18: a link already produced the file
      !email.attachments.some((a) => a.attachmentId && isInScope(a))
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
          logger.error(`[pdf] generation failed for ${maskId(email.id)} (keeping body-only):`, e)
        }
      }

      if (deps.store.insert(invoice)) summary.downloaded++
      else summary.skipped++
    }
  )

  return summary
}
