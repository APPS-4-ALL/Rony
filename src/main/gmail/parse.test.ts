import { describe, it, expect } from 'vitest'
import {
  decodeBase64Url,
  getHeader,
  stripHtml,
  parseMessage,
  toDeterministicInput,
  isPdfOrImage,
  isInlineImageName,
  buildSearchQuery,
  type GmailMessage,
  type GmailAttachmentRef
} from './parse'
import { classifyDeterministic } from '../../shared/engines/deterministic'

/** Encode UTF-8 text the way Gmail does (base64url) for a part body. */
function b64url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url')
}

describe('decodeBase64Url', () => {
  it('round-trips UTF-8 text (incl. Hebrew)', () => {
    expect(decodeBase64Url(b64url('חשבונית מס 123'))).toBe('חשבונית מס 123')
  })
  it('returns empty string for undefined/garbage', () => {
    expect(decodeBase64Url(undefined)).toBe('')
  })
})

describe('getHeader', () => {
  const headers = [
    { name: 'Subject', value: 'Hello' },
    { name: 'From', value: 'a@b.com' }
  ]
  it('is case-insensitive', () => {
    expect(getHeader(headers, 'subject')).toBe('Hello')
    expect(getHeader(headers, 'FROM')).toBe('a@b.com')
  })
  it('returns empty string when missing', () => {
    expect(getHeader(headers, 'Cc')).toBe('')
    expect(getHeader(undefined, 'Subject')).toBe('')
  })
})

describe('stripHtml', () => {
  it('drops script/style bodies, turns tags to spaces, collapses whitespace', () => {
    const html = `<style>.x{color:red}</style><p>Your <b>invoice</b></p><script>evil()</script>`
    expect(stripHtml(html)).toBe('Your invoice')
  })
  it('decodes common and numeric entities', () => {
    expect(stripHtml('Tom &amp; Jerry &#39;s bill &#x26; co &nbsp;done')).toBe(
      "Tom & Jerry 's bill & co done"
    )
  })
})

describe('parseMessage — body extraction', () => {
  it('parses a simple text/plain message and its headers', () => {
    const msg: GmailMessage = {
      id: 'm1',
      threadId: 't1',
      snippet: 'preview',
      internalDate: String(Date.UTC(2026, 4, 20)), // 2026-05-20
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'Subject', value: 'Your receipt' },
          { name: 'From', value: 'Store <billing@store.com>' }
        ],
        body: { size: 11, data: b64url('Thank you!') }
      }
    }
    const parsed = parseMessage(msg)
    expect(parsed).toMatchObject({
      id: 'm1',
      threadId: 't1',
      subject: 'Your receipt',
      from: 'Store <billing@store.com>',
      date: '2026-05-20',
      snippet: 'preview',
      bodyText: 'Thank you!',
      attachments: []
    })
  })

  it('prefers text/plain over text/html in a multipart/alternative', () => {
    const msg: GmailMessage = {
      id: 'm2',
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('plain version') } },
          { mimeType: 'text/html', body: { data: b64url('<p>html <b>version</b></p>') } }
        ]
      }
    }
    expect(parseMessage(msg).bodyText).toBe('plain version')
  })

  it('falls back to stripped HTML when there is no plain part', () => {
    const msg: GmailMessage = {
      id: 'm3',
      payload: {
        mimeType: 'text/html',
        body: { data: b64url('<h1>Tax Invoice</h1><p>Total: 100</p>') }
      }
    }
    expect(parseMessage(msg).bodyText).toBe('Tax Invoice Total: 100')
  })

  it('returns null date for a missing/invalid internalDate', () => {
    expect(parseMessage({ id: 'm4', payload: {} }).date).toBeNull()
  })
})

describe('parseMessage — attachments', () => {
  it('captures attachment metadata (incl. attachmentId) and excludes it from the body', () => {
    const msg: GmailMessage = {
      id: 'm5',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [{ mimeType: 'text/plain', body: { data: b64url('See attached invoice.') } }]
          },
          {
            mimeType: 'application/pdf',
            filename: 'invoice_2026.pdf',
            body: { size: 20480, attachmentId: 'ATT_123' }
          }
        ]
      }
    }
    const parsed = parseMessage(msg)
    expect(parsed.bodyText).toBe('See attached invoice.')
    expect(parsed.attachments).toEqual([
      {
        filename: 'invoice_2026.pdf',
        mimeType: 'application/pdf',
        attachmentId: 'ATT_123',
        size: 20480,
        inline: false
      }
    ])
  })

  it('flags inline signature/logo images (Content-Disposition / Content-ID) as inline', () => {
    const msg: GmailMessage = {
      id: 'm6',
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('הצעת מחיר מצורפת') } },
          // The real attachment: explicitly a file.
          {
            mimeType: 'application/pdf',
            filename: 'quote.pdf',
            headers: [{ name: 'Content-Disposition', value: 'attachment; filename="quote.pdf"' }],
            body: { size: 30000, attachmentId: 'REAL' }
          },
          // A signature logo embedded in the HTML body via cid: — NOT a real file.
          {
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [
              { name: 'Content-Disposition', value: 'inline; filename="logo.png"' },
              { name: 'Content-ID', value: '<logo@aman>' }
            ],
            body: { size: 45000, attachmentId: 'LOGO' }
          }
        ]
      }
    }
    const byName = Object.fromEntries(parseMessage(msg).attachments.map((a) => [a.filename, a]))
    expect(byName['quote.pdf'].inline).toBe(false)
    expect(byName['logo.png'].inline).toBe(true)
  })
})

describe('isPdfOrImage — PDF/image attachment filter', () => {
  const att = (over: Partial<GmailAttachmentRef>): GmailAttachmentRef => ({
    filename: 'file',
    mimeType: 'application/octet-stream',
    attachmentId: 'A',
    size: 1,
    inline: false,
    ...over
  })

  it('accepts PDFs and images by MIME type', () => {
    expect(isPdfOrImage(att({ mimeType: 'application/pdf' }))).toBe(true)
    expect(isPdfOrImage(att({ mimeType: 'image/png' }))).toBe(true)
    expect(isPdfOrImage(att({ mimeType: 'image/jpeg' }))).toBe(true)
  })

  it('falls back to the filename extension when MIME is generic', () => {
    expect(isPdfOrImage(att({ filename: 'invoice.PDF' }))).toBe(true)
    expect(isPdfOrImage(att({ filename: 'scan.JPG' }))).toBe(true)
    expect(isPdfOrImage(att({ filename: 'receipt.heic' }))).toBe(true)
  })

  it('rejects non-PDF/image attachments', () => {
    expect(isPdfOrImage(att({ mimeType: 'application/zip', filename: 'a.zip' }))).toBe(false)
    expect(
      isPdfOrImage(
        att({
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          filename: 'a.docx'
        })
      )
    ).toBe(false)
    expect(isPdfOrImage(att({ mimeType: 'text/csv', filename: 'a.csv' }))).toBe(false)
  })
})

describe('buildSearchQuery — documents OR body-only keywords + date range', () => {
  it('matches document attachments (incl. office types) OR invoice keywords', () => {
    const q = buildSearchQuery()
    expect(q).toContain('has:attachment')
    expect(q).toContain('filename:(pdf OR jpg OR jpeg OR png')
    expect(q).toContain('docx') // widened beyond PDF/image
    expect(q).toContain('invoice') // body-only keyword branch
    expect(q).toContain('חשבונית')
    expect(q).toContain('"tax invoice"') // multi-word terms are phrase-quoted
    // High-precision only: broad, non-financial words must NOT widen the net.
    expect(q).not.toContain('הזמנה')
    expect(q).not.toContain('order confirmation')
  })

  it('can restrict to attachments only (no keyword branch)', () => {
    const q = buildSearchQuery({ attachmentsOnly: true })
    expect(q).toContain('has:attachment')
    expect(q).not.toContain('invoice') // keyword branch omitted
  })

  it('uses the default window only when no range is given', () => {
    expect(buildSearchQuery({ defaultWindow: '1y' })).toContain('newer_than:1y')
  })

  it('converts ISO dates to Gmail YYYY/MM/DD and omits the default window', () => {
    const q = buildSearchQuery({ after: '2026-01-01', before: '2026-06-30', defaultWindow: '1y' })
    expect(q).toContain('after:2026/01/01')
    expect(q).toContain('before:2026/06/30')
    expect(q).not.toContain('newer_than')
  })
})

describe('RONY-7 → RONY-9 handoff', () => {
  it('feeds a parsed Hebrew invoice email straight into the deterministic engine', () => {
    const msg: GmailMessage = {
      id: 'm6',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [{ name: 'Subject', value: 'החשבונית שלך מצורפת' }],
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('שלום, מצורפת קבלה.') } },
          { mimeType: 'application/pdf', filename: 'kabala.pdf', body: { attachmentId: 'A1' } }
        ]
      }
    }
    const result = classifyDeterministic(toDeterministicInput(parseMessage(msg)))
    expect(result.isInvoice).toBe(true)
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['חשבונית', 'קבלה']))
  })
})

describe('isInlineImageName — Outlook embedded image/signature detection', () => {
  it('matches the auto-generated image00N.* names', () => {
    expect(isInlineImageName('image001.png')).toBe(true)
    expect(isInlineImageName('image012.jpg')).toBe(true)
    expect(isInlineImageName('IMAGE001.PNG')).toBe(true) // case-insensitive
    expect(isInlineImageName('image1000.gif')).toBe(true) // 4+ digits
    expect(isInlineImageName(' image002.jpeg ')).toBe(true) // trimmed
  })

  it('does NOT match real attachment names or 1–2 digit "image" names', () => {
    expect(isInlineImageName('invoice.png')).toBe(false)
    expect(isInlineImageName('receipt-2026.jpg')).toBe(false)
    expect(isInlineImageName('image1.png')).toBe(false) // a screenshot, not the Outlook pattern
    expect(isInlineImageName('scan-image001.png')).toBe(false) // pattern must be the whole name
    expect(isInlineImageName('image001.pdf')).toBe(false) // PDFs are real documents
  })
})

describe('parseMessage — RONY-18 link extraction', () => {
  it('collects <a href> links from the HTML body onto the parsed email', () => {
    const html = '<p>שלום</p><a href="https://vendor.co.il/inv/5?t=1&amp;u=2">להורדת החשבונית</a>'
    const msg: GmailMessage = {
      id: 'm-link',
      payload: {
        mimeType: 'text/html',
        headers: [{ name: 'Subject', value: 'החשבונית שלך' }],
        body: { data: b64url(html) }
      }
    }
    expect(parseMessage(msg).links).toEqual([
      { url: 'https://vendor.co.il/inv/5?t=1&u=2', text: 'להורדת החשבונית' }
    ])
  })

  it('has an empty links list when the body has none', () => {
    const msg: GmailMessage = {
      id: 'm-nolink',
      payload: { mimeType: 'text/plain', body: { data: b64url('שלום, אין כאן קישור.') } }
    }
    expect(parseMessage(msg).links).toEqual([])
  })
})
