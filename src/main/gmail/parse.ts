/**
 * RONY-7 — Gmail message parsing (pure, network-free).
 *
 * Turns a raw Gmail API message (the `users.messages.get?format=full` JSON)
 * into a clean, flat `ParsedEmail`: subject/from/date, a plain-text body, and
 * the list of attachments. Kept free of Electron / network imports so it can be
 * unit-tested in isolation (and reused by the classifier without side effects).
 *
 * The Gmail body lives in a (possibly deeply nested) MIME tree where each
 * leaf's text is base64url-encoded. We walk the tree, decode the text parts,
 * strip HTML when no plain-text alternative exists, and collect attachment
 * metadata (including the `attachmentId` that RONY-11 needs to download them).
 */
import type { DeterministicInput } from '../../shared/engines/deterministic'
import { extractBareUrls, extractLinks, type EmailLink } from './links'

/* ------------------------------------------------------------------ *
 * Minimal Gmail API shapes — only the fields we actually read.
 * ------------------------------------------------------------------ */

export interface GmailHeader {
  name: string
  value: string
}

export interface GmailPartBody {
  size?: number
  /** base64url-encoded content for inline text parts. */
  data?: string
  /** Present on attachment parts — the handle used to fetch the bytes (RONY-11). */
  attachmentId?: string
}

export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailPartBody
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId?: string
  snippet?: string
  /** Epoch milliseconds, as a string, of when Gmail received the message. */
  internalDate?: string
  payload?: GmailPart
}

/* ------------------------------------------------------------------ *
 * Parsed output shapes (what the rest of the app consumes).
 * ------------------------------------------------------------------ */

/** One attachment found on a message. `attachmentId` is null for inline data. */
export interface GmailAttachmentRef {
  filename: string
  mimeType: string
  /** Handle for `users.messages.attachments.get` (RONY-11). Null if inline. */
  attachmentId: string | null
  size: number
  /**
   * True when the part is embedded IN the message body (a `cid:`-referenced
   * signature logo / inline image), not a real attached file — detected via
   * `Content-Disposition: inline` or a `Content-ID` header. The download/vision
   * layers skip inline images so logos never get saved as "invoices".
   */
  inline: boolean
}

/** A Gmail message flattened into the fields Rony cares about. */
export interface ParsedEmail {
  id: string
  threadId: string | null
  subject: string
  from: string
  /** ISO-8601 date (YYYY-MM-DD) derived from internalDate, or null if unknown. */
  date: string | null
  snippet: string
  /** Decoded, HTML-stripped plain-text body. */
  bodyText: string
  attachments: GmailAttachmentRef[]
  /**
   * Hyperlinks found in the body (RONY-18) — used to download invoices that are
   * behind a "download" link rather than attached. Empty when the body has none.
   */
  links: EmailLink[]
}

/** Decode a base64url string (Gmail's encoding for part bodies) to UTF-8. */
export function decodeBase64Url(data: string | undefined): string {
  if (!data) return ''
  try {
    return Buffer.from(data, 'base64url').toString('utf-8')
  } catch {
    return ''
  }
}

/** Case-insensitive header lookup. */
export function getHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) return ''
  const lower = name.toLowerCase()
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

/**
 * Strip HTML to readable plain text: drop <script>/<style> bodies entirely,
 * turn tags into spaces, decode the handful of common entities, then collapse
 * runs of whitespace. Good enough to feed the keyword classifier — we are not
 * trying to faithfully render the email, just expose its words.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/** A leaf part is an attachment when it carries a (non-empty) filename. */
function isAttachment(part: GmailPart): boolean {
  return Boolean(part.filename && part.filename.trim())
}

/* ------------------------------------------------------------------ *
 * DoS guards for the MIME walk.
 *
 * The structure and bytes of a message are attacker-influenced — anyone who can
 * email the user. A crafted message can nest parts thousands deep (overflowing
 * the recursion stack), declare tens of thousands of attachment parts (memory),
 * or carry a giant text body (memory now, plus CPU later in stripHtml / the
 * keyword classifier / regex extractors). We bound all three here. Hitting a cap
 * degrades gracefully: we keep whatever we collected up to the limit and stop —
 * a normal email never comes close to any of these.
 * ------------------------------------------------------------------ */

/** Deepest MIME nesting we will walk before abandoning a branch. */
export const MAX_MIME_DEPTH = 50

/** Most attachment parts we will record for a single message. */
export const MAX_ATTACHMENTS_PER_EMAIL = 500

/** Most decoded body text (UTF-8 bytes) we retain across all text parts. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Truncate `text` to at most `maxBytes` UTF-8 bytes, on a code-point boundary. */
function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.length <= maxBytes) return text
  // Back the cut off any partial multi-byte code point so we never decode a
  // severed char (which would surface as a U+FFFD replacement and could even
  // re-encode past the cap). UTF-8 continuation bytes match 0b10xxxxxx; step
  // back until the boundary sits on a leading byte.
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf-8')
}

/**
 * Depth-first walk of the MIME tree, collecting decoded text and attachments.
 * Prefers text/plain; only falls back to (stripped) text/html when no plain
 * alternative was found, so we don't double-count the same content twice.
 *
 * `depth` tracks how deep we have recursed (for the MAX_MIME_DEPTH guard) and
 * `acc.bytes` the running total of retained body text (for MAX_BODY_BYTES).
 */
function collect(
  part: GmailPart | undefined,
  acc: {
    plain: string[]
    html: string[]
    attachments: GmailAttachmentRef[]
    links: EmailLink[]
    bytes: number
  },
  depth = 0
): void {
  // DoS guard: stop before pathologically deep nesting can overflow the stack
  // (a malicious message can nest message/rfc822 parts thousands deep).
  if (!part || depth > MAX_MIME_DEPTH) return

  if (isAttachment(part)) {
    // DoS guard: cap the number of attachment parts we record per message.
    if (acc.attachments.length >= MAX_ATTACHMENTS_PER_EMAIL) return
    // Inline parts (signature logos, embedded body images) carry a Content-ID
    // and/or `Content-Disposition: inline`. A real attached file is `attachment`
    // (or unspecified). We flag inline so the invoice scan can ignore logos.
    const disposition = getHeader(part.headers, 'Content-Disposition').toLowerCase().trimStart()
    const hasContentId = getHeader(part.headers, 'Content-ID').trim().length > 0
    const inline =
      disposition.startsWith('inline') || (hasContentId && !disposition.startsWith('attachment'))
    acc.attachments.push({
      filename: part.filename as string,
      mimeType: part.mimeType ?? 'application/octet-stream',
      attachmentId: part.body?.attachmentId ?? null,
      size: part.body?.size ?? 0,
      inline
    })
    return // don't treat an attachment's bytes as body text
  }

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) collect(child, acc, depth + 1)
    return
  }

  // Leaf text part.
  const decoded = decodeBase64Url(part.body?.data)
  if (!decoded) return
  // DoS guard: keep total retained body under MAX_BODY_BYTES. Truncate this
  // piece to the remaining budget and stop once it's spent, so a multipart
  // "bomb" of many large text parts can't exhaust memory.
  const remaining = MAX_BODY_BYTES - acc.bytes
  if (remaining <= 0) return
  const text = truncateToBytes(decoded, remaining)
  // The retained pieces are later join('\n')-ed, so each one also costs the byte
  // of its separator. Charging +1 here keeps the FINAL joined body under the cap
  // even when an attacker uses many tiny parts.
  if (part.mimeType === 'text/plain') {
    acc.plain.push(text)
    acc.links.push(...extractBareUrls(text)) // RONY-18: bare URLs in plain text
    acc.bytes += Buffer.byteLength(text, 'utf-8') + 1
  } else if (part.mimeType === 'text/html') {
    acc.html.push(stripHtml(text))
    acc.links.push(...extractLinks(text)) // RONY-18: <a href> links before we strip
    acc.bytes += Buffer.byteLength(text, 'utf-8') + 1
  }
}

/** De-duplicate links by URL, keeping the first non-empty anchor text seen. */
function dedupeLinks(links: EmailLink[]): EmailLink[] {
  const byUrl = new Map<string, EmailLink>()
  for (const link of links) {
    const existing = byUrl.get(link.url)
    if (!existing) byUrl.set(link.url, { ...link })
    else if (!existing.text && link.text) existing.text = link.text
  }
  return [...byUrl.values()]
}

/**
 * Convert Gmail's internalDate (epoch ms string) to a YYYY-MM-DD date in the
 * machine's LOCAL timezone, or null. We deliberately avoid toISOString() here:
 * it formats in UTC, so an email received just after local midnight in any zone
 * ahead of UTC (e.g. Israel, UTC+2/+3) rolls back to the previous calendar day —
 * the date would render one day BEFORE what Gmail shows the user. Reading local
 * date components keeps the date aligned with the user's calendar.
 */
function isoDateFromInternal(internalDate: string | undefined): string | null {
  if (!internalDate) return null
  const ms = Number(internalDate)
  if (!Number.isFinite(ms) || ms <= 0) return null
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parse a raw Gmail message into the flat `ParsedEmail` shape. */
export function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers
  const acc = {
    plain: [] as string[],
    html: [] as string[],
    attachments: [] as GmailAttachmentRef[],
    links: [] as EmailLink[],
    bytes: 0
  }
  collect(msg.payload, acc)

  // Prefer the plain-text parts; fall back to stripped HTML only if there were none.
  const bodyText = (acc.plain.length > 0 ? acc.plain : acc.html).join('\n').trim()

  return {
    id: msg.id,
    threadId: msg.threadId ?? null,
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    date: isoDateFromInternal(msg.internalDate),
    snippet: msg.snippet ?? '',
    bodyText,
    attachments: acc.attachments,
    links: dedupeLinks(acc.links)
  }
}

/** Adapt a parsed email into the input shape the RONY-9 classifier expects. */
export function toDeterministicInput(email: ParsedEmail): DeterministicInput {
  return {
    subject: email.subject,
    body: email.bodyText,
    filenames: email.attachments.map((a) => a.filename)
  }
}

/* ------------------------------------------------------------------ *
 * Attachment-type filtering (RONY-7).
 *
 * The ticket scopes RONY-7 to messages whose attachments are PDFs or images.
 * We judge by MIME type first (authoritative), falling back to the filename
 * extension when a sender mislabels the part as application/octet-stream.
 * ------------------------------------------------------------------ */

/** File extensions we treat as images (lower-case, no dot). */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff']

/** True if the attachment is a PDF or an image (by MIME type or extension). */
export function isPdfOrImage(att: GmailAttachmentRef): boolean {
  const mime = att.mimeType.toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('image/')) return true
  const ext = att.filename.toLowerCase().split('.').pop() ?? ''
  return ext === 'pdf' || IMAGE_EXTENSIONS.includes(ext)
}

/**
 * Office / text document extensions we ALSO accept as candidate invoice files.
 * The AI can't read inside these (only PDFs/images go to the vision model), but
 * we still fetch + download them so the user has the file locally.
 */
const DOC_EXTENSIONS = ['docx', 'doc', 'xlsx', 'xls', 'csv'] as const

/** Allowlist of every extension we treat as a candidate invoice document. */
export const INVOICE_DOC_EXTENSIONS = ['pdf', ...IMAGE_EXTENSIONS, ...DOC_EXTENSIONS]

/**
 * True if the attachment is a candidate invoice document — a PDF, an image, or a
 * common office/text doc. Judges by MIME first, falling back to the filename
 * extension (senders often mislabel these as application/octet-stream). The
 * allowlist keeps out junk/system files (.ics, .vcf, .p7s, winmail.dat, …).
 */
export function isInvoiceDocument(att: GmailAttachmentRef): boolean {
  const mime = att.mimeType.toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('image/')) return true
  const ext = att.filename.toLowerCase().split('.').pop() ?? ''
  return INVOICE_DOC_EXTENSIONS.includes(ext)
}

/**
 * Outlook / Exchange auto-name EMBEDDED body & signature images `image001.png`,
 * `image002.jpg`, … (3+ zero-padded digits). These are logos/signatures, never
 * the invoice itself — but they sometimes arrive WITHOUT the inline disposition
 * or Content-ID that would let us flag them via `att.inline` (e.g. when a mail
 * marks them `Content-Disposition: attachment`). Recognising the naming pattern
 * is a reliable second signal so a signature logo never gets saved as an invoice
 * or sent to the vision model.
 */
const INLINE_IMAGE_NAME = /^image\d{3,}\.(?:png|jpe?g|gif|bmp|webp|tiff?|heic|heif)$/i

/** True when an image's filename looks like a mail-client embedded body/signature image. */
export function isInlineImageName(filename: string): boolean {
  return INLINE_IMAGE_NAME.test(filename.trim())
}

/** Options that shape the Gmail search query RONY-7 runs. */
export interface SearchQueryOptions {
  /** Lower date bound, inclusive (ISO YYYY-MM-DD). */
  after?: string
  /** Upper date bound, exclusive (ISO YYYY-MM-DD). */
  before?: string
  /** Used only when neither `after` nor `before` is given (e.g. "1y", "90d"). */
  defaultWindow?: string
  /**
   * Restrict to emails that carry a document attachment. Default (false) ALSO
   * pulls in body-only invoices/receipts by matching invoice keywords — RONY-9/10
   * classify on the email text, so a receipt printed in the body still counts.
   */
  attachmentsOnly?: boolean
}

/**
 * Invoice/receipt keywords that pull body-only emails (no attachment) into the
 * search, in both languages. Kept HIGH-PRECISION on purpose: with a small
 * `maxResults`, Gmail returns only the newest matches, so broad words like
 * "order" (הזמנה) / "order confirmation" — which aren't financial documents
 * anyway — would flood the budget with marketing/shipping mail and crowd out
 * real invoices. The scan engine still classifies each match afterwards.
 */
export const BODY_RECEIPT_TERMS = [
  'invoice',
  'receipt',
  'tax invoice',
  'payment receipt',
  'חשבונית',
  'חשבונית מס',
  'קבלה',
  'אישור תשלום',
  'דרישת תשלום'
] as const

/** Gmail's date operators want YYYY/MM/DD; accept ISO YYYY-MM-DD and convert. */
function toGmailDate(iso: string): string {
  return iso.replace(/-/g, '/')
}

/** Phrase-quote a Gmail term when it has whitespace, so it matches exactly. */
function gmailTerm(term: string): string {
  return /\s/.test(term) ? `"${term}"` : term
}

/**
 * Build the Gmail search query for RONY-7, optionally bounded by a date range.
 * Two branches, OR-ed together (unless `attachmentsOnly`):
 *   1. emails carrying a document attachment (PDF/image/office — see the
 *      `filename:` allowlist), and
 *   2. body-only invoices/receipts that match an invoice keyword.
 * We constrain at the Gmail level (not just client-side) so we page over far
 * fewer messages; `maxResults` upstream caps the total either way.
 *
 * The `filename:`/keyword terms are the coarse net; the engine + the
 * per-attachment MIME check are the authoritative second pass.
 */
export function buildSearchQuery(opts: SearchQueryOptions = {}): string {
  const attachmentClause = `has:attachment filename:(${INVOICE_DOC_EXTENSIONS.join(' OR ')})`
  const scope = opts.attachmentsOnly
    ? attachmentClause
    : `(${attachmentClause}) OR (${BODY_RECEIPT_TERMS.map(gmailTerm).join(' OR ')})`

  // Wrap the (possibly OR-ed) scope so the date filters AND with the whole thing.
  const parts = [`(${scope})`]
  if (opts.after) parts.push(`after:${toGmailDate(opts.after)}`)
  if (opts.before) parts.push(`before:${toGmailDate(opts.before)}`)
  if (!opts.after && !opts.before && opts.defaultWindow) {
    parts.push(`newer_than:${opts.defaultWindow}`)
  }

  return parts.join(' ')
}
