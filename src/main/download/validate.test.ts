import { describe, expect, it } from 'vitest'
import { detectSignature, validateDocument } from './validate'

/* ------------------------------------------------------------------ *
 * Minimal real-format byte fixtures (header + padding past the 16-byte floor).
 * ------------------------------------------------------------------ */
const pad = (head: Buffer | number[], total = 64): Buffer => {
  const h = Buffer.isBuffer(head) ? head : Buffer.from(head)
  return Buffer.concat([h, Buffer.alloc(Math.max(0, total - h.length))])
}

const PDF = pad(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj', 'latin1'))
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0])
const GIF = pad(Buffer.from('GIF89a', 'latin1'))
const BMP = pad(Buffer.from('BM', 'latin1'))
const TIFF = pad([0x49, 0x49, 0x2a, 0x00])
const WEBP = pad(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))
const HEIC = pad(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic')]))
const ZIP = pad([0x50, 0x4b, 0x03, 0x04]) // docx/xlsx envelope
const OLE = pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) // legacy .doc/.xls
const HTML = pad(Buffer.from('<!DOCTYPE html><html><body>Access denied</body></html>', 'latin1'))
const HTML_WS = pad(Buffer.from('\n   <html><head></head></html>', 'latin1'))
const CSV = pad(Buffer.from('vendor,amount,date\nAcme,100,2026-05-01\n', 'latin1'))

describe('detectSignature — magic bytes', () => {
  it('recognises each supported binary format', () => {
    expect(detectSignature(PDF)).toBe('pdf')
    expect(detectSignature(PNG)).toBe('png')
    expect(detectSignature(JPEG)).toBe('jpeg')
    expect(detectSignature(GIF)).toBe('gif')
    expect(detectSignature(BMP)).toBe('bmp')
    expect(detectSignature(TIFF)).toBe('tiff')
    expect(detectSignature(WEBP)).toBe('webp')
    expect(detectSignature(HEIC)).toBe('heic')
    expect(detectSignature(ZIP)).toBe('zip')
    expect(detectSignature(OLE)).toBe('ole')
  })

  it('detects HTML pages (incl. leading whitespace)', () => {
    expect(detectSignature(HTML)).toBe('html')
    expect(detectSignature(HTML_WS)).toBe('html')
  })

  it('finds %PDF even with a few leading junk bytes', () => {
    expect(detectSignature(pad(Buffer.from('﻿  %PDF-1.4 rest', 'latin1')))).toBe('pdf')
  })

  it('returns null for plain text / CSV (no signature)', () => {
    expect(detectSignature(CSV)).toBeNull()
  })
})

describe('validateDocument — RONY-17 authenticity gate', () => {
  it('accepts a real PDF named .pdf', () => {
    expect(
      validateDocument({ filename: 'invoice.pdf', mimeType: 'application/pdf', bytes: PDF })
    ).toEqual({ valid: true })
  })

  it('accepts real images for image extensions', () => {
    expect(validateDocument({ filename: 'r.png', mimeType: 'image/png', bytes: PNG }).valid).toBe(
      true
    )
    expect(validateDocument({ filename: 'r.jpg', mimeType: 'image/jpeg', bytes: JPEG }).valid).toBe(
      true
    )
    expect(
      validateDocument({ filename: 'r.webp', mimeType: 'image/webp', bytes: WEBP }).valid
    ).toBe(true)
    expect(
      validateDocument({ filename: 'r.heic', mimeType: 'image/heic', bytes: HEIC }).valid
    ).toBe(true)
  })

  it('accepts office + csv documents', () => {
    expect(
      validateDocument({ filename: 'i.docx', mimeType: 'application/octet-stream', bytes: ZIP })
        .valid
    ).toBe(true)
    expect(
      validateDocument({ filename: 'i.xls', mimeType: 'application/octet-stream', bytes: OLE })
        .valid
    ).toBe(true)
    expect(validateDocument({ filename: 'i.csv', mimeType: 'text/csv', bytes: CSV }).valid).toBe(
      true
    )
  })

  it('accepts a PDF mislabeled as octet-stream (trusts the extension + bytes)', () => {
    expect(
      validateDocument({
        filename: 'invoice.pdf',
        mimeType: 'application/octet-stream',
        bytes: PDF
      }).valid
    ).toBe(true)
  })

  it('rejects an empty or truncated download', () => {
    expect(
      validateDocument({
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.alloc(0)
      }).valid
    ).toBe(false)
    const truncated = validateDocument({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF')
    })
    expect(truncated.valid).toBe(false)
    expect(truncated.reason).toMatch(/truncated/)
  })

  it('rejects an HTML error/login page returned instead of the file', () => {
    const v = validateDocument({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: HTML
    })
    expect(v.valid).toBe(false)
    expect(v.reason).toMatch(/HTML/)
  })

  it('rejects a type mismatch — a .pdf whose bytes are actually a PNG', () => {
    const v = validateDocument({ filename: 'invoice.pdf', mimeType: 'application/pdf', bytes: PNG })
    expect(v.valid).toBe(false)
    expect(v.reason).toMatch(/expected a PDF/)
  })

  it('rejects an image extension that is not actually an image', () => {
    expect(
      validateDocument({ filename: 'scan.png', mimeType: 'image/png', bytes: PDF }).valid
    ).toBe(false)
  })

  it('rejects a .csv that is really a binary file', () => {
    expect(validateDocument({ filename: 'data.csv', mimeType: 'text/csv', bytes: PDF }).valid).toBe(
      false
    )
  })

  it('accepts an unknown type rather than dropping a possibly-real file', () => {
    // No usable extension or MIME hint, non-empty, not HTML → accepted.
    expect(
      validateDocument({
        filename: 'document',
        mimeType: 'application/octet-stream',
        bytes: pad(Buffer.from('arbitrary binary payload'))
      }).valid
    ).toBe(true)
  })
})
