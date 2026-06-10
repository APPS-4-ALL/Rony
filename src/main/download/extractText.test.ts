import { describe, expect, it } from 'vitest'
import { extractDocumentText } from './extractText'
import { validateContent } from './validate'

/**
 * Build a minimal, valid single-page PDF whose text the standard 14 fonts can
 * render (so it's extractable). Latin only — Helvetica can't draw Hebrew glyphs,
 * and the Hebrew keyword matching is covered by validateContent's own tests; this
 * proves the unpdf → validateContent pipeline end to end.
 */
function buildPdf(lines: string[]): Buffer {
  const objs: string[] = []
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>'
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>'
  objs[3] =
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'
  const stream = `BT /F1 18 Tf 20 160 Td 18 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`
  objs[4] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xrefPos = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<</Size ${objs.length}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

describe('extractDocumentText — RONY-17 real extraction', () => {
  it('extracts text from a genuine invoice PDF, which then passes the content gate', async () => {
    const bytes = buildPdf(['INVOICE No 5567', 'Subtotal 100', 'VAT 17', 'Total Amount Due 117'])
    const text = await extractDocumentText({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes
    })

    expect(text).toContain('INVOICE')
    expect(text).toContain('VAT')
    // End-to-end: extracted text → content gate → pass.
    expect(validateContent(text).valid).toBe(true)
  })

  it('a real PDF with no invoice keywords fails the content gate (content_mismatch)', async () => {
    const bytes = buildPdf(['BOARDING PASS', 'Gate 22 Seat 14C', 'Flight LY001'])
    const text = await extractDocumentText({
      filename: 'pass.pdf',
      mimeType: 'application/pdf',
      bytes
    })

    expect(text).toContain('BOARDING')
    const verdict = validateContent(text)
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(/content_mismatch/)
  })

  it('reads plain text / CSV directly', async () => {
    const csv = Buffer.from('vendor,total,vat\nAcme,100,17\n', 'utf-8')
    const text = await extractDocumentText({
      filename: 'data.csv',
      mimeType: 'text/csv',
      bytes: csv
    })
    expect(text).toContain('total')
  })

  it('returns null for images (no embedded text — content check is skipped)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const text = await extractDocumentText({
      filename: 'receipt.png',
      mimeType: 'image/png',
      bytes: png
    })
    expect(text).toBeNull()
    expect(validateContent(text)).toEqual({ valid: true, skipped: true })
  })

  it('returns null for an unreadable / non-PDF that claims to be a PDF (fallback to skip)', async () => {
    const garbage = Buffer.from('%PDF-1.4 this is not really a pdf at all', 'latin1')
    const text = await extractDocumentText({
      filename: 'broken.pdf',
      mimeType: 'application/pdf',
      bytes: garbage
    })
    expect(text).toBeNull()
  })
})
