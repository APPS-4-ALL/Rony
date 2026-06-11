/**
 * RONY-17 — deterministic, OFFLINE text extraction for the content-keyword gate.
 *
 * Pulls the text OUT of a freshly downloaded document so `validateContent()` can
 * confirm it reads like an invoice/receipt. Strictly deterministic — NO AI / LLM
 * / OCR:
 *   - PDF              → unpdf (a pure-JS pdf.js build; no native binaries)
 *   - text / CSV / txt → decode the bytes directly
 *   - images / Office / anything else → `null` (no embedded text without OCR), so
 *     the caller SKIPS the content check rather than dropping a legitimate file.
 *
 * Never throws: any failure (encrypted/garbled PDF, bad bytes) resolves to `null`,
 * which the content gate treats as "couldn't judge → skip".
 *
 * unpdf is ESM-only; electron-vite externalises it and the Node runtime
 * (≥ 22.12, both dev and Electron 39) loads it via `require(ESM)`.
 */
import { extractText, getDocumentProxy } from 'unpdf'
import { MAX_PARSE_BYTES } from '../../shared/limits'
import { logger, maskFile } from '../lib/log'

/** Extensions whose bytes are already plain text. */
const TEXT_EXTENSIONS = new Set(['csv', 'txt'])

/** Lower-case extension without the dot, or '' when there is none. */
function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? ''
}

/**
 * Extract a document's text for the content gate, or `null` when no text can be
 * obtained deterministically (an image, an Office doc, an unreadable/encrypted
 * PDF, or an extraction error).
 */
export async function extractDocumentText(doc: {
  filename: string
  mimeType: string
  bytes: Buffer
}): Promise<string | null> {
  const { filename, mimeType, bytes } = doc
  const ext = extensionOf(filename)
  const mime = mimeType.toLowerCase()

  // DoS guard: never parse an oversized payload (decompression bomb / runaway
  // page count). Skipping returns null → the content gate treats it as "couldn't
  // judge" and the file is still kept; we just don't auto-extract from it.
  if (bytes.length > MAX_PARSE_BYTES) {
    logger.warn(
      `[validate] skipping text extraction for ${maskFile(filename)}: ` +
        `${bytes.length} bytes exceeds ${MAX_PARSE_BYTES}-byte parse cap`
    )
    return null
  }

  // Plain text / CSV — the bytes ARE the text.
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
    return bytes.toString('utf-8')
  }

  // PDF — extract with unpdf (pdf.js). Return null on any read failure so an
  // encrypted/garbled PDF is skipped (never rejected) by the content gate.
  if (ext === 'pdf' || mime === 'application/pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await extractText(pdf, { mergePages: true })
      return Array.isArray(text) ? text.join('\n') : text
    } catch (e) {
      logger.warn(`[validate] unpdf could not read ${maskFile(filename)}:`, e)
      return null
    }
  }

  // Images, Office docs, unknown types — no deterministic text without OCR/parsing.
  return null
}
