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

/**
 * Depth-first walk of the MIME tree, collecting decoded text and attachments.
 * Prefers text/plain; only falls back to (stripped) text/html when no plain
 * alternative was found, so we don't double-count the same content twice.
 */
function collect(
  part: GmailPart | undefined,
  acc: { plain: string[]; html: string[]; attachments: GmailAttachmentRef[] }
): void {
  if (!part) return

  if (isAttachment(part)) {
    acc.attachments.push({
      filename: part.filename as string,
      mimeType: part.mimeType ?? 'application/octet-stream',
      attachmentId: part.body?.attachmentId ?? null,
      size: part.body?.size ?? 0
    })
    return // don't treat an attachment's bytes as body text
  }

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) collect(child, acc)
    return
  }

  // Leaf text part.
  const text = decodeBase64Url(part.body?.data)
  if (!text) return
  if (part.mimeType === 'text/plain') acc.plain.push(text)
  else if (part.mimeType === 'text/html') acc.html.push(stripHtml(text))
}

/** Convert Gmail's internalDate (epoch ms string) to an ISO date, or null. */
function isoDateFromInternal(internalDate: string | undefined): string | null {
  if (!internalDate) return null
  const ms = Number(internalDate)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString().slice(0, 10)
}

/** Parse a raw Gmail message into the flat `ParsedEmail` shape. */
export function parseMessage(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers
  const acc = {
    plain: [] as string[],
    html: [] as string[],
    attachments: [] as GmailAttachmentRef[]
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
    attachments: acc.attachments
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

/** Options that shape the Gmail search query RONY-7 runs. */
export interface SearchQueryOptions {
  /** Lower date bound, inclusive (ISO YYYY-MM-DD). */
  after?: string
  /** Upper date bound, exclusive (ISO YYYY-MM-DD). */
  before?: string
  /** Used only when neither `after` nor `before` is given (e.g. "1y", "90d"). */
  defaultWindow?: string
}

/** Gmail's date operators want YYYY/MM/DD; accept ISO YYYY-MM-DD and convert. */
function toGmailDate(iso: string): string {
  return iso.replace(/-/g, '/')
}

/**
 * Build the Gmail search query for RONY-7: messages that carry a PDF or image
 * attachment, optionally bounded by a date range. We constrain at the Gmail
 * level (not just client-side) so we page over far fewer messages.
 *
 * The `filename:` terms match by extension; the per-attachment MIME check in
 * the fetch layer is the authoritative second pass.
 */
export function buildSearchQuery(opts: SearchQueryOptions = {}): string {
  const exts = ['pdf', ...IMAGE_EXTENSIONS]
  const parts = ['has:attachment', `filename:(${exts.join(' OR ')})`]

  if (opts.after) parts.push(`after:${toGmailDate(opts.after)}`)
  if (opts.before) parts.push(`before:${toGmailDate(opts.before)}`)
  if (!opts.after && !opts.before && opts.defaultWindow) {
    parts.push(`newer_than:${opts.defaultWindow}`)
  }

  return parts.join(' ')
}
