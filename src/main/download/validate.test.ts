import { describe, expect, it } from 'vitest'
import { detectSignature, validateContent, validateDocument } from './validate'

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

describe('validateContent — RONY-17 content-keyword gate', () => {
  it('passes Hebrew invoice text and reports the matched keywords', () => {
    const v = validateContent('חשבונית מס 1234\nסה"כ לתשלום כולל מע"מ: 117 ₪')
    expect(v.valid).toBe(true)
    expect(v.skipped).toBe(false)
    expect(v.matched).toEqual(expect.arrayContaining(['חשבונית', 'חשבונית מס']))
  })

  it('passes English invoice text', () => {
    const v = validateContent('TAX INVOICE\nSubtotal: 100\nVAT: 17\nTotal Amount Due: 117')
    expect(v.valid).toBe(true)
    expect(v.matched).toEqual(expect.arrayContaining(['invoice', 'total', 'vat']))
  })

  it('matches Hebrew prefix forms and gershayim/quote variants', () => {
    // "החשבונית" (the-invoice) and מע״מ written with a gershayim, not an ASCII ".
    expect(validateContent('להלן פרטי החשבונית שלך').valid).toBe(true)
    expect(validateContent('כולל מע״מ כחוק').matched).toContain('מע"מ')
  })

  it('matches a phrase that wraps across a line break', () => {
    expect(validateContent('TAX\nINVOICE NO 7').matched).toContain('tax invoice')
  })

  it('rejects a valid document whose text is NOT an invoice (e.g. a boarding pass)', () => {
    const v = validateContent('BOARDING PASS\nGate 22  Seat 14C\nFlight LY001  Tel Aviv → London')
    expect(v.valid).toBe(false)
    expect(v.skipped).toBe(false)
    expect(v.reason).toMatch(/content_mismatch/)
  })

  it('SKIPS (does not reject) when no text could be extracted', () => {
    expect(validateContent(null)).toEqual({ valid: true, skipped: true })
    expect(validateContent('')).toEqual({ valid: true, skipped: true })
    expect(validateContent('   \n\t ')).toEqual({ valid: true, skipped: true })
  })

  it('rejects a billing FAQ even though it mentions "invoice"', () => {
    const v = validateContent(
      'Billing and Payment Frequently Asked Questions. What changes with my invoice? ...'
    )
    expect(v.valid).toBe(false)
    expect(v.reason).toMatch(/non-invoice document/)
  })

  it('rejects a bank-transfer confirmation (debtor/creditor), not a real invoice', () => {
    const v = validateContent(
      'TRANSACTION REFERENCE 0712\nPAYMENT IN AMOUNT 2,664.00 EUR IS EXECUTED\nDEBTOR KRIISP\nCREDITOR ELI (A.B)\nIBAN IL84'
    )
    expect(v.valid).toBe(false)
    expect(v.reason).toMatch(/bank transfer/)
  })

  it('does NOT pass on the weak "amount" word alone (needs a real invoice term)', () => {
    expect(validateContent('Total amount paid for your order: 50').valid).toBe(true) // "total" is a real term
    expect(validateContent('The amount you requested is attached.').valid).toBe(false) // only "amount"
  })
})
