/**
 * RONY-17 — Downloaded-document validation.
 *
 * Confirms that the bytes we just fetched for an engine-approved attachment are
 * genuinely the kind of document they claim to be — a real PDF / image / Office
 * / text file — and not an artefact masquerading as one:
 *   - an empty or truncated download (dropped connection, error response),
 *   - an HTML "session expired / access denied" page a vendor portal returned
 *     instead of the actual file, or
 *   - a binary whose extension lies about its content (e.g. a `.pdf` that is
 *     really a PNG, or junk).
 *
 * This is the file-type / authenticity gate the ticket asks for. It COMPLEMENTS
 * (does not replace) the upstream checks:
 *   - the Gmail query + `isInvoiceDocument` extension/MIME allowlist, and
 *   - the engine classification of the EMAIL as an invoice/receipt (RONY-9/10).
 * Those answer "should we download this?"; this answers "is what we actually
 * downloaded a valid document?".
 *
 * Pure + dependency-free (magic-byte inspection only), so it unit-tests in
 * isolation and has no Electron/network/SQLite coupling.
 */

/** The downloaded document to check. */
export interface DocumentToValidate {
  /** Original attachment file name (used for the expected-type hint). */
  filename: string
  /** Gmail-reported MIME type (a secondary hint — senders often mislabel). */
  mimeType: string
  /** The fetched file bytes. */
  bytes: Buffer
}

/** Verdict for one document. */
export interface ValidationResult {
  valid: boolean
  /** Short English explanation when invalid — for logs (not user-facing). */
  reason?: string
}

/**
 * Files below this are empty or truncated downloads — never a real document.
 * Kept low so a small-but-legitimate CSV/text receipt isn't rejected; the
 * signature checks below do the real discrimination.
 */
const MIN_DOCUMENT_BYTES = 16

/** Image file extensions (lower-case, no dot) — mirrors the RONY-7 allowlist. */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff']

/** Concrete formats we can recognise from a file's leading "magic" bytes. */
type DetectedType =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'tiff'
  | 'heic'
  | 'zip'
  | 'ole'
  | 'html'

/** Detected types that are bitmap images (any of these satisfies an image expectation). */
const IMAGE_TYPES: ReadonlySet<DetectedType> = new Set([
  'png',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'tiff',
  'heic'
])

/** ISO-BMFF brand codes (bytes 8–11, after `ftyp`) that mean a HEIC/HEIF image. */
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']

/** True when `bytes` matches `sig` (a list of byte values) starting at `offset`. */
function hasBytesAt(bytes: Buffer, offset: number, sig: readonly number[]): boolean {
  if (bytes.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false
  }
  return true
}

/** True when the ISO-BMFF brand at bytes 8–11 is a known HEIC/HEIF brand. */
function isHeicBrand(bytes: Buffer): boolean {
  const brand = bytes.subarray(8, 12).toString('latin1').toLowerCase()
  return HEIC_BRANDS.includes(brand)
}

/**
 * Heuristic: does the file START with HTML? We skip a leading UTF-8 BOM and any
 * ASCII whitespace, then look for a common HTML opener. This catches the very
 * common failure mode of a portal/CDN returning an error/login PAGE where the
 * caller expected a binary document.
 */
function looksLikeHtml(bytes: Buffer): boolean {
  let i = hasBytesAt(bytes, 0, [0xef, 0xbb, 0xbf]) ? 3 : 0
  while (i < bytes.length && i < 64) {
    const b = bytes[i]
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i++
      continue
    }
    break
  }
  const head = bytes
    .subarray(i, Math.min(i + 64, bytes.length))
    .toString('latin1')
    .toLowerCase()
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body') ||
    head.startsWith('<!--')
  )
}

/**
 * Identify a file from its leading bytes, or return `null` when nothing matches
 * (e.g. plain text / CSV, which carry no signature). Exported for unit tests.
 */
export function detectSignature(bytes: Buffer): DetectedType | null {
  // PDFs occasionally carry a BOM or a few junk bytes before "%PDF-", so scan a
  // small head window rather than insisting it is byte 0.
  const head = bytes.subarray(0, Math.min(1024, bytes.length)).toString('latin1')
  if (head.includes('%PDF-')) return 'pdf'

  if (hasBytesAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (hasBytesAt(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return 'gif' // "GIF8"
  if (
    hasBytesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && // "RIFF"
    hasBytesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]) // "WEBP"
  ) {
    return 'webp'
  }
  if (
    hasBytesAt(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBytesAt(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return 'tiff'
  }
  if (hasBytesAt(bytes, 4, [0x66, 0x74, 0x79, 0x70]) && isHeicBrand(bytes)) return 'heic' // "ftyp"
  if (hasBytesAt(bytes, 0, [0x42, 0x4d])) return 'bmp' // "BM" (only 2 bytes — see note below)
  if (hasBytesAt(bytes, 0, [0x50, 0x4b])) return 'zip' // "PK" — zip / OOXML (docx/xlsx)
  if (hasBytesAt(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole' // legacy Office
  if (looksLikeHtml(bytes)) return 'html'
  return null
}

/** The document family we EXPECT, derived from the filename + MIME hint. */
type ExpectedKind = 'pdf' | 'image' | 'ooxml' | 'legacy-office' | 'text' | 'unknown'

const OOXML_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx'])
const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'xls', 'ppt'])
const TEXT_EXTENSIONS = new Set(['csv', 'txt'])

/** Lower-case extension without the dot, or '' when there is none. */
function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? ''
}

/**
 * What family of document should these bytes be? We trust the FILE EXTENSION
 * first (senders routinely mislabel the MIME as application/octet-stream), then
 * fall back to the MIME type, then `unknown`.
 */
function expectedKind(filename: string, mimeType: string): ExpectedKind {
  const ext = extensionOf(filename)
  const mime = mimeType.toLowerCase()
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (IMAGE_EXTENSIONS.includes(ext) || mime.startsWith('image/')) return 'image'
  if (OOXML_EXTENSIONS.has(ext)) return 'ooxml'
  if (LEGACY_OFFICE_EXTENSIONS.has(ext)) return 'legacy-office'
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) return 'text'
  return 'unknown'
}

/** Human-readable description of a detected type, for the rejection reason. */
function describe(detected: DetectedType | null): string {
  if (detected === null) return 'unrecognized data'
  if (detected === 'html') return 'an HTML page'
  if (detected === 'zip') return 'a zip/Office (OOXML) package'
  if (detected === 'ole') return 'a legacy-Office (OLE) file'
  return `a ${detected.toUpperCase()} file`
}

/**
 * Validate a freshly downloaded document. Returns `{ valid: true }` when the
 * bytes credibly match the expected document type, or `{ valid: false, reason }`
 * when they look like an error/irrelevant file we should NOT record.
 *
 * Design note: the bias is toward ACCEPTING anything plausible — we only reject
 * on a positive signal of junk (empty/truncated, an HTML page, or a concrete
 * type that contradicts the extension). An `unknown` expectation (no extension
 * hint and an unrecognised MIME) is accepted, so we never silently drop a
 * legitimate-but-unusual file; the upstream allowlist already gates obvious junk.
 */
export function validateDocument(doc: DocumentToValidate): ValidationResult {
  const { filename, mimeType, bytes } = doc

  if (bytes.length < MIN_DOCUMENT_BYTES) {
    return { valid: false, reason: `empty or truncated (${bytes.length} bytes)` }
  }

  const detected = detectSignature(bytes)
  const expected = expectedKind(filename, mimeType)

  // An HTML page where ANY document was expected is the classic "portal returned
  // a login/error page instead of the file" case.
  if (detected === 'html') {
    return { valid: false, reason: 'looks like an HTML/error page, not a document' }
  }

  switch (expected) {
    case 'pdf':
      return detected === 'pdf'
        ? { valid: true }
        : { valid: false, reason: `expected a PDF but found ${describe(detected)}` }

    case 'image':
      return detected !== null && IMAGE_TYPES.has(detected)
        ? { valid: true }
        : { valid: false, reason: `expected an image but found ${describe(detected)}` }

    case 'ooxml':
      // docx/xlsx/pptx are zip containers — we can confirm the PK envelope but
      // not the inner part layout without unzipping (out of scope here).
      return detected === 'zip'
        ? { valid: true }
        : {
            valid: false,
            reason: `expected an Office (OOXML) file but found ${describe(detected)}`
          }

    case 'legacy-office':
      return detected === 'ole'
        ? { valid: true }
        : { valid: false, reason: `expected a legacy Office file but found ${describe(detected)}` }

    case 'text':
      // Plain text / CSV has no magic signature. Accept when nothing binary was
      // detected; reject only when the bytes are clearly a DIFFERENT binary
      // format (the extension lying about its content).
      return detected === null
        ? { valid: true }
        : { valid: false, reason: `expected text/CSV but found ${describe(detected)}` }

    case 'unknown':
    default:
      // No firm type expectation. The obvious junk (empty/HTML) is already
      // rejected above; accept the rest rather than risk dropping a real file.
      return { valid: true }
  }
}
