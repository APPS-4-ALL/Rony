import { describe, it, expect } from 'vitest'
import {
  MAX_VISION_BYTES,
  isVisionSupported,
  pickInvoiceAttachment,
  visionMimeType
} from './attachments'
import type { GmailAttachmentRef } from '../../gmail/parse'

function att(over: Partial<GmailAttachmentRef> = {}): GmailAttachmentRef {
  return {
    filename: 'file.pdf',
    mimeType: 'application/pdf',
    attachmentId: 'a1',
    size: 1024,
    inline: false,
    ...over
  }
}

describe('visionMimeType', () => {
  it('trusts real PDF/image MIME types', () => {
    expect(visionMimeType(att({ mimeType: 'application/pdf' }))).toBe('application/pdf')
    expect(visionMimeType(att({ mimeType: 'image/png', filename: 'x.png' }))).toBe('image/png')
    expect(visionMimeType(att({ mimeType: 'IMAGE/JPEG', filename: 'x.jpg' }))).toBe('image/jpeg')
  })

  it('recovers the type from the extension when a sender mislabels the part', () => {
    // The HashDoc.pdf case: a real PDF attached as application/octet-stream.
    expect(
      visionMimeType(att({ mimeType: 'application/octet-stream', filename: 'HashDoc.pdf' }))
    ).toBe('application/pdf')
    expect(
      visionMimeType(att({ mimeType: 'application/octet-stream', filename: 'scan.JPG' }))
    ).toBe('image/jpeg')
  })

  it('returns null for genuinely unsupported types', () => {
    expect(visionMimeType(att({ mimeType: 'text/plain', filename: 'a.txt' }))).toBeNull()
    expect(
      visionMimeType(att({ mimeType: 'application/octet-stream', filename: 'a.docx' }))
    ).toBeNull()
  })
})

describe('isVisionSupported', () => {
  it('accepts PDFs and images (by MIME or extension), rejects others', () => {
    expect(isVisionSupported(att({ mimeType: 'application/pdf' }))).toBe(true)
    expect(isVisionSupported(att({ mimeType: 'image/png', filename: 'a.png' }))).toBe(true)
    // Mislabeled but really a PDF → still supported.
    expect(
      isVisionSupported(att({ mimeType: 'application/octet-stream', filename: 'a.pdf' }))
    ).toBe(true)
    expect(isVisionSupported(att({ mimeType: 'text/plain', filename: 'a.txt' }))).toBe(false)
    expect(
      isVisionSupported(att({ mimeType: 'application/octet-stream', filename: 'a.bin' }))
    ).toBe(false)
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

  it('picks a PDF even when it is mislabeled as octet-stream', () => {
    const mislabeled = att({ filename: 'HashDoc.pdf', mimeType: 'application/octet-stream' })
    expect(pickInvoiceAttachment([mislabeled])).toBe(mislabeled)
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

  it('skips genuinely unsupported types', () => {
    const docx = att({
      filename: 'x.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })
    expect(pickInvoiceAttachment([docx])).toBeNull()
  })

  it('skips an inline logo image (never sends a signature logo to the model)', () => {
    const logo = att({
      filename: 'logo.png',
      mimeType: 'image/png',
      attachmentId: 'LOGO',
      size: 60_000,
      inline: true
    })
    expect(pickInvoiceAttachment([logo])).toBeNull()
  })

  it('skips an Outlook signature image by name even when not flagged inline', () => {
    const sig = att({
      filename: 'image001.png',
      mimeType: 'image/png',
      attachmentId: 'SIG',
      size: 60_000,
      inline: false // header flag missing — caught by the name pattern
    })
    expect(pickInvoiceAttachment([sig])).toBeNull()
  })

  it('prefers a real attachment image over an inline logo', () => {
    const logo = att({
      filename: 'logo.png',
      mimeType: 'image/png',
      attachmentId: 'LOGO',
      size: 90_000,
      inline: true
    })
    const scan = att({
      filename: 'receipt.jpg',
      mimeType: 'image/jpeg',
      attachmentId: 'SCAN',
      size: 40_000
    })
    expect(pickInvoiceAttachment([logo, scan])).toBe(scan)
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
