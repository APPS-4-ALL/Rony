import { describe, it, expect } from 'vitest'
import { MAX_VISION_BYTES, isVisionSupported, pickInvoiceAttachment } from './attachments'
import type { GmailAttachmentRef } from '../../gmail/parse'

function att(over: Partial<GmailAttachmentRef> = {}): GmailAttachmentRef {
  return {
    filename: 'file.pdf',
    mimeType: 'application/pdf',
    attachmentId: 'a1',
    size: 1024,
    ...over
  }
}

describe('isVisionSupported', () => {
  it('accepts PDFs and images, rejects others', () => {
    expect(isVisionSupported('application/pdf')).toBe(true)
    expect(isVisionSupported('image/png')).toBe(true)
    expect(isVisionSupported('IMAGE/JPEG')).toBe(true)
    expect(isVisionSupported('text/plain')).toBe(false)
    expect(isVisionSupported('application/octet-stream')).toBe(false)
  })
})

describe('pickInvoiceAttachment', () => {
  it('returns null when there are no usable attachments', () => {
    expect(pickInvoiceAttachment([])).toBeNull()
  })

  it('prefers a PDF over images', () => {
    const pdf = att({ filename: 'invoice.pdf', mimeType: 'application/pdf' })
    const img = att({
      filename: 'logo.png',
      mimeType: 'image/png',
      attachmentId: 'a2',
      size: 99999
    })
    expect(pickInvoiceAttachment([img, pdf])).toBe(pdf)
  })

  it('falls back to the largest image when there is no PDF', () => {
    const small = att({ filename: 's.png', mimeType: 'image/png', attachmentId: 's', size: 10_000 })
    const big = att({ filename: 'b.jpg', mimeType: 'image/jpeg', attachmentId: 'b', size: 500_000 })
    expect(pickInvoiceAttachment([small, big])).toBe(big)
  })

  it('skips attachments without a downloadable id', () => {
    const inline = att({ attachmentId: null })
    expect(pickInvoiceAttachment([inline])).toBeNull()
  })

  it('skips unsupported MIME types', () => {
    const docx = att({
      filename: 'x.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    expect(pickInvoiceAttachment([docx])).toBeNull()
  })

  it('skips files larger than the inline cap', () => {
    const huge = att({ size: MAX_VISION_BYTES + 1 })
    expect(pickInvoiceAttachment([huge])).toBeNull()
  })

  it('keeps files of unknown size (size 0)', () => {
    const unknown = att({ size: 0 })
    expect(pickInvoiceAttachment([unknown])).toBe(unknown)
  })
})
