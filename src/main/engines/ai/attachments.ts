/**
 * RONY-10 — Choosing which attachment to show the vision model.
 *
 * To read the TOTAL amount the model needs the document itself, but sending
 * every attachment of every candidate email would be slow and costly. We pick
 * ONE representative invoice file per email and gate it on size, so a giant
 * file can never blow past the provider's inline-payload limit. Pure + free of
 * Electron/network imports, so it is fully unit-testable.
 */
import type { GmailAttachmentRef } from '../../gmail/parse'

/**
 * Hard cap on a file we will inline into a model request. Gemini's
 * `generateContent` rejects requests whose total inline payload exceeds ~20 MB;
 * base64 also inflates bytes by ~33%, so we stay well under with a 15 MB cap on
 * the raw file. Larger files fall back to text-only classification.
 */
export const MAX_VISION_BYTES = 15 * 1024 * 1024

/**
 * Extension → canonical MIME, used to recover the real type when a sender
 * mislabels the part (e.g. a PDF attached as `application/octet-stream`, which
 * many ERP/receipt systems do). Mirrors the extensions the RONY-7 download
 * filter accepts, so anything we save to disk we can also send to the model.
 */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

/**
 * The MIME type to send a vision model for this attachment, or `null` when it
 * isn't a PDF/image we can read. A real PDF/image MIME is trusted as-is;
 * otherwise we fall back to the filename extension — a real PDF mislabeled as
 * `application/octet-stream` must still be sent with a correct type or the
 * model can't read it. (This is why downloaded files were silently skipped by
 * the vision pass before.)
 */
export function visionMimeType(att: GmailAttachmentRef): string | null {
  const mime = att.mimeType.toLowerCase()
  if (mime === 'application/pdf' || mime.startsWith('image/')) return mime
  const ext = att.filename.toLowerCase().split('.').pop() ?? ''
  return EXT_MIME[ext] ?? null
}

/** True when an attachment is a PDF/image our vision adapters can send. */
export function isVisionSupported(att: GmailAttachmentRef): boolean {
  return visionMimeType(att) !== null
}

/**
 * Pick the single attachment most likely to BE the invoice document, or null if
 * none is usable. Preference order:
 *   1. the first PDF (invoices are overwhelmingly PDFs);
 *   2. otherwise the largest image (a scan/photo of the receipt).
 * Only candidates with a downloadable `attachmentId`, a vision-supported type
 * (by MIME or extension), and a size within `MAX_VISION_BYTES` are considered.
 */
export function pickInvoiceAttachment(
  attachments: GmailAttachmentRef[]
): GmailAttachmentRef | null {
  const usable = attachments.filter(
    (a) =>
      a.attachmentId !== null &&
      isVisionSupported(a) &&
      // Skip inline signature/logo images — they'd otherwise win the "largest
      // image" fallback below and get sent to the model instead of the invoice.
      !(a.inline && visionMimeType(a) !== 'application/pdf') &&
      (a.size === 0 || a.size <= MAX_VISION_BYTES)
  )
  if (usable.length === 0) return null

  const pdf = usable.find((a) => visionMimeType(a) === 'application/pdf')
  if (pdf) return pdf

  return usable.reduce((largest, a) => (a.size > largest.size ? a : largest))
}
