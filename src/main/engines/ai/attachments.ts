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

/** True when a MIME type is something our vision adapters can send. */
export function isVisionSupported(mimeType: string): boolean {
  const mime = mimeType.toLowerCase()
  return mime === 'application/pdf' || mime.startsWith('image/')
}

/**
 * Pick the single attachment most likely to BE the invoice document, or null if
 * none is usable. Preference order:
 *   1. the first PDF (invoices are overwhelmingly PDFs);
 *   2. otherwise the largest image (a scan/photo of the receipt).
 * Only candidates with a downloadable `attachmentId`, a vision-supported type,
 * and a size within `MAX_VISION_BYTES` are considered.
 */
export function pickInvoiceAttachment(
  attachments: GmailAttachmentRef[]
): GmailAttachmentRef | null {
  const usable = attachments.filter(
    (a) =>
      a.attachmentId !== null &&
      isVisionSupported(a.mimeType) &&
      (a.size === 0 || a.size <= MAX_VISION_BYTES)
  )
  if (usable.length === 0) return null

  const pdf = usable.find((a) => a.mimeType.toLowerCase() === 'application/pdf')
  if (pdf) return pdf

  return usable.reduce((largest, a) => (a.size > largest.size ? a : largest))
}
