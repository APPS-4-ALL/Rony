import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadApproved, sanitizeFilename, type ApprovedEmail, type InvoiceStore } from './core'
import { validateDocument } from './validate'
import type { NewInvoice } from '../../shared/types'
import type { GmailAttachmentRef, ParsedEmail } from '../gmail/parse'

/** In-memory store that records inserts (conflict-safe, like the real SQLite one). */
function fakeStore(): InvoiceStore & { rows: NewInvoice[] } {
  const rows: NewInvoice[] = []
  return {
    rows,
    existsByPath: (path) => rows.some((r) => r.localFilePath === path),
    existsByMessageId: (id) => rows.some((r) => r.messageId === id),
    insert: (invoice) => {
      if (invoice.localFilePath && rows.some((r) => r.localFilePath === invoice.localFilePath)) {
        return false
      }
      rows.push(invoice)
      return true
    }
  }
}

/** A fetcher that returns deterministic fake bytes keyed by attachment id. */
function fakeFetch(): (messageId: string, attachmentId: string) => Promise<Buffer> {
  return (_messageId: string, attachmentId: string): Promise<Buffer> =>
    Promise.resolve(Buffer.from(`bytes-for-${attachmentId}`))
}

function att(over: Partial<GmailAttachmentRef> = {}): GmailAttachmentRef {
  return {
    filename: 'invoice.pdf',
    mimeType: 'application/pdf',
    attachmentId: 'A1',
    size: 50_000,
    inline: false,
    ...over
  }
}

function approvedEmail(
  attachments: GmailAttachmentRef[],
  over: Partial<ApprovedEmail> = {},
  bodyText = ''
): ApprovedEmail {
  const email: ParsedEmail = {
    id: 'msg1',
    threadId: null,
    subject: 'חשבונית מס',
    from: 'vendor@x.co.il',
    date: '2026-05-01',
    snippet: '',
    bodyText,
    attachments,
    links: []
  }
  return { email, engineType: 'deterministic', ...over }
}

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'rony-dl-'))
  return dir
}

describe('downloadApproved — RONY-11 DoD', () => {
  it('saves a PDF and an image to disk and records a row for each', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({ filename: 'invoice.pdf', mimeType: 'application/pdf', attachmentId: 'A1' }),
        att({ filename: 'receipt.jpg', mimeType: 'image/jpeg', attachmentId: 'A2' })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toEqual({ downloaded: 2, skipped: 0, rejected: 0, errors: 0 })

    // Files exist on disk (file name carries the attachment index — see #1)...
    const pdfPath = join(targetDir, 'msg1__0__invoice.pdf')
    const imgPath = join(targetDir, 'msg1__1__receipt.jpg')
    expect(existsSync(pdfPath)).toBe(true)
    expect(existsSync(imgPath)).toBe(true)
    expect(readFileSync(pdfPath).toString()).toBe('bytes-for-A1')

    // ...and a SQLite-bound row was recorded for each, carrying the file path.
    expect(store.rows).toHaveLength(2)
    expect(store.rows.find((r) => r.localFilePath === pdfPath)).toMatchObject({
      messageId: 'msg1',
      localFilePath: pdfPath,
      status: 'downloaded',
      engineType: 'deterministic'
    })
  })

  it('is idempotent — a second run skips files already on disk + recorded (dedup)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att()])]

    const first = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })
    const second = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(first.downloaded).toBe(1)
    expect(second).toMatchObject({ downloaded: 0, skipped: 1 })
    expect(store.rows).toHaveLength(1) // no duplicate row
  })

  it('downloads the real attachment but skips an inline signature logo', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    // The reported case: an invoice email whose HTML signature embeds a company
    // logo (a large inline image). Only the real PDF should be saved.
    const approved = [
      approvedEmail([
        att({ filename: 'quote.pdf', mimeType: 'application/pdf', attachmentId: 'A1' }),
        att({
          filename: 'logo.png',
          mimeType: 'image/png',
          attachmentId: 'LOGO',
          size: 45_000, // well over MIN_IMAGE_BYTES — size alone wouldn't catch it
          inline: true
        })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, skipped: 1 })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0].localFilePath).toContain('quote.pdf')
    expect(existsSync(join(targetDir, 'msg1__1__logo.png'))).toBe(false)
  })

  // #1 — same-name attachments in one email must NOT silently drop one of them.
  it('keeps both files when an email has two same-named attachments', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({ filename: 'invoice.pdf', attachmentId: 'A1' }),
        att({ filename: 'invoice.pdf', attachmentId: 'A2' })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 2 })
    expect(store.rows).toHaveLength(2)
    expect(new Set(store.rows.map((r) => r.localFilePath)).size).toBe(2) // distinct paths
    // The SECOND file's bytes were not lost to a name collision.
    expect(readFileSync(join(targetDir, 'msg1__1__invoice.pdf')).toString()).toBe('bytes-for-A2')
  })

  // #3 — a file the user deleted from disk is re-fetched, without a duplicate row.
  it('restores a deleted file without inserting a duplicate row', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att()])]

    await downloadApproved(approved, { targetDir, fetchAttachment: fakeFetch(), store })
    const filePath = store.rows[0].localFilePath as string
    rmSync(filePath) // user deletes the file, DB row remains
    expect(existsSync(filePath)).toBe(false)

    const second = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(second).toMatchObject({ downloaded: 1 }) // restored
    expect(existsSync(filePath)).toBe(true)
    expect(store.rows).toHaveLength(1) // no duplicate row
  })

  // #2 — if a concurrent scan wins the insert race, count it as skipped.
  it('counts a lost insert race as skipped, not downloaded', async () => {
    const targetDir = tempDir()
    const store: InvoiceStore = {
      existsByPath: () => false, // not recorded when we checked...
      existsByMessageId: () => false,
      insert: () => false // ...but the conflict-safe insert lost the race
    }

    const summary = await downloadApproved([approvedEmail([att()])], {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 0, skipped: 1 })
  })

  it('skips inline data (no attachmentId) and tiny logo-sized images', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({ filename: 'inline.png', mimeType: 'image/png', attachmentId: null }),
        att({ filename: 'logo.png', mimeType: 'image/png', attachmentId: 'A3', size: 2_000 }),
        att({ filename: 'real.pdf', mimeType: 'application/pdf', attachmentId: 'A4' })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, skipped: 2 })
    expect(store.rows[0].localFilePath).toContain('real.pdf')
  })

  it('skips an Outlook signature image (image001.png) even when not flagged inline', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    // The real-world case: a financial email carrying its real invoice PDF plus a
    // big ZEEKR-style signature logo that arrived WITHOUT the inline flag.
    const approved = [
      approvedEmail([
        att({ filename: 'invoice.pdf', mimeType: 'application/pdf', attachmentId: 'A1' }),
        att({
          filename: 'image001.png',
          mimeType: 'image/png',
          attachmentId: 'A2',
          size: 60_000, // well past the size gate
          inline: false // header flag missing — only the NAME betrays it
        })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, skipped: 1 })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0].localFilePath).toContain('invoice.pdf')
  })

  it('uses AI-extracted metadata when provided', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([att()], {
        engineType: 'ai',
        extracted: { vendor: 'Acme Ltd', amount: 351, currency: 'ILS', date: '2026-04-30' }
      })
    ]

    await downloadApproved(approved, { targetDir, fetchAttachment: fakeFetch(), store })

    expect(store.rows[0]).toMatchObject({
      vendor: 'Acme Ltd',
      amount: 351,
      currency: 'ILS',
      date: '2026-04-30',
      engineType: 'ai'
    })
  })

  it('downloads office documents (docx/xlsx) too, not just PDFs/images', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({
          filename: 'invoice.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          attachmentId: 'D1',
          size: 20_000
        }),
        // mislabeled as octet-stream, but the .xlsx extension is allowlisted
        att({ filename: 'data.xlsx', mimeType: 'application/octet-stream', attachmentId: 'X1' })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 2 })
    const paths = store.rows.map((r) => r.localFilePath ?? '')
    expect(paths.some((p) => p.includes('invoice.docx'))).toBe(true)
    expect(paths.some((p) => p.includes('data.xlsx'))).toBe(true)
  })

  it('records a file-less row for a body-only receipt (no attachment)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail(
        [],
        {
          engineType: 'ai',
          extracted: { vendor: 'Animal Express', amount: 64, currency: 'ILS', date: '2026-05-30' }
        },
        'סך הכל: 64.00 ₪'
      )
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(summary).toMatchObject({ downloaded: 1 })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      messageId: 'msg1',
      localFilePath: null,
      emailBody: 'סך הכל: 64.00 ₪', // the body is kept so the user can view it
      vendor: 'Animal Express',
      amount: 64,
      engineType: 'ai'
    })
  })

  it('renders a body-only receipt into a generated PDF when a renderer is given', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const renderEmailPdf = vi.fn(async (data: { subject: string | null }) => {
      void data
      return Buffer.from('%PDF-1.4 fake')
    })
    const approved = [
      approvedEmail(
        [],
        {
          engineType: 'ai',
          extracted: { vendor: 'Animal Express', amount: 64, currency: 'ILS', date: '2026-05-30' }
        },
        'סך הכל: 64.00 ₪'
      )
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      renderEmailPdf,
      store
    })

    expect(renderEmailPdf).toHaveBeenCalledOnce()
    expect(renderEmailPdf.mock.calls[0][0]).toMatchObject({ subject: 'חשבונית מס' }) // #5: subject passed
    expect(summary).toMatchObject({ downloaded: 1 })
    const row = store.rows[0]
    expect(row.generated).toBe(true)
    expect(row.localFilePath).toContain('msg1__email.pdf')
    expect(row.emailBody).toBeNull() // the body now lives in the generated PDF
    expect(existsSync(row.localFilePath as string)).toBe(true)
  })

  it('falls back to a file-less row when PDF rendering fails/hangs (the #1 timeout path)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    // Simulate what the render timeout produces: a rejected promise.
    const renderEmailPdf = vi.fn(async () => {
      throw new Error('PDF print timed out after 8000ms')
    })
    const approved = [
      approvedEmail(
        [],
        {
          engineType: 'ai',
          extracted: { vendor: 'X', amount: 10, currency: 'ILS', date: '2026-05-30' }
        },
        'סך הכל: 10'
      )
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      renderEmailPdf,
      store
    })

    expect(summary).toMatchObject({ downloaded: 1 }) // row still recorded
    const row = store.rows[0]
    expect(row.generated).toBe(false) // no PDF
    expect(row.localFilePath).toBeNull()
    expect(row.emailBody).toBe('סך הכל: 10') // kept for the in-app popup
  })

  it('dedups a body-only receipt by message id on re-scan', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([], {
        engineType: 'ai',
        extracted: { vendor: 'X', amount: 10, currency: 'ILS', date: '2026-05-30' }
      })
    ]

    const first = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })
    const second = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store
    })

    expect(first.downloaded).toBe(1)
    expect(second).toMatchObject({ downloaded: 0, skipped: 1 })
    expect(store.rows).toHaveLength(1) // no duplicate body-only row
  })

  it('does NOT record a body-only receipt for the deterministic engine', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const renderEmailPdf = vi.fn(async () => Buffer.from('%PDF-1.4 fake'))
    // A deterministic keyword match with no attachment + no extracted fields:
    // body-only is a smart-scan (AI) feature, so this must produce no row/PDF.
    const approved = [approvedEmail([], { engineType: 'deterministic' }, 'תודה, קיבלנו את פנייתך')]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      renderEmailPdf,
      store
    })

    expect(renderEmailPdf).not.toHaveBeenCalled()
    expect(store.rows).toHaveLength(0)
    expect(summary.downloaded).toBe(0)
  })

  it('counts a failed download without aborting the rest', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({ filename: 'bad.pdf', attachmentId: 'BAD' }),
        att({ filename: 'good.pdf', attachmentId: 'GOOD' })
      ])
    ]
    const flaky = (_m: string, a: string): Promise<Buffer> =>
      a === 'BAD' ? Promise.reject(new Error('boom')) : Promise.resolve(Buffer.from('ok'))

    const summary = await downloadApproved(approved, { targetDir, fetchAttachment: flaky, store })

    expect(summary).toMatchObject({ downloaded: 1, errors: 1 })
    expect(store.rows).toHaveLength(1)
  })
})

describe('downloadApproved — RONY-17 document validation', () => {
  const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)])
  const HTML_BYTES = Buffer.from('<!DOCTYPE html><html><body>session expired</body></html>')

  /** Fetch real bytes per attachment id: a valid PDF, an HTML page, or an empty file. */
  const fetchByKind = (_m: string, a: string): Promise<Buffer> => {
    if (a === 'PDF') return Promise.resolve(PDF_BYTES)
    if (a === 'HTML') return Promise.resolve(HTML_BYTES)
    return Promise.resolve(Buffer.alloc(0)) // 'EMPTY'
  }

  it('records the valid PDF and rejects the HTML page + the empty file', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([
        att({ filename: 'real.pdf', attachmentId: 'PDF' }),
        att({ filename: 'portal.pdf', attachmentId: 'HTML' }),
        att({ filename: 'cut.pdf', attachmentId: 'EMPTY' })
      ])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fetchByKind,
      validateDocument,
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 2, errors: 0 })
    // Only the genuine PDF made it to disk + the DB.
    expect(store.rows).toHaveLength(1)
    expect(existsSync(join(targetDir, 'msg1__0__real.pdf'))).toBe(true)
    expect(existsSync(join(targetDir, 'msg1__1__portal.pdf'))).toBe(false)
    expect(existsSync(join(targetDir, 'msg1__2__cut.pdf'))).toBe(false)
  })

  it('skips validation when no validator is injected (historical behaviour)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'real.pdf', attachmentId: 'HTML' })])]

    // No `validateDocument` in deps → the HTML bytes are accepted as before.
    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fetchByKind,
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 0 })
    expect(store.rows).toHaveLength(1)
  })
})

describe('downloadApproved — RONY-17 content validation', () => {
  it('records a PDF whose extracted text reads like an invoice', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'inv.pdf', attachmentId: 'A1' })])]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => 'חשבונית מס 555\nסה"כ לתשלום 100 ₪',
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 0 })
    expect(store.rows).toHaveLength(1)
  })

  it('rejects a valid PDF whose text has no invoice keywords (content_mismatch)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'pass.pdf', attachmentId: 'A1' })])]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => 'Boarding pass — gate 5, seat 9A, flight LY1',
      store
    })

    expect(summary).toMatchObject({ downloaded: 0, rejected: 1 })
    expect(store.rows).toHaveLength(0)
    expect(existsSync(join(targetDir, 'msg1__0__pass.pdf'))).toBe(false)
  })

  it('keeps an image — content check is skipped (no extractable text)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([att({ filename: 'receipt.jpg', mimeType: 'image/jpeg', attachmentId: 'A1' })])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => null, // images yield no extractable text
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 0 })
    expect(store.rows).toHaveLength(1)
  })

  it('does not reject when text extraction throws (encrypted/unreadable PDF)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'locked.pdf', attachmentId: 'A1' })])]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => {
        throw new Error('encrypted PDF')
      },
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 0 })
    expect(store.rows).toHaveLength(1)
  })
})

describe('downloadApproved — RONY-18 link-based download', () => {
  /** An approved email with a download link and NO attachment. */
  function linkEmail(
    links: { url: string; text: string }[],
    engineType: 'ai' | 'deterministic' = 'deterministic'
  ): ApprovedEmail {
    const email: ParsedEmail = {
      id: 'msg-link',
      threadId: null,
      subject: 'החשבונית שלך',
      from: 'vendor@x.co',
      date: '2026-05-01',
      snippet: '',
      bodyText: 'להורדת החשבונית לחצו על הקישור',
      attachments: [],
      links
    }
    return { email, engineType }
  }

  it('follows an invoice link and records the downloaded document', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      linkEmail([{ url: 'https://vendor.co/invoice.pdf', text: 'להורדת החשבונית' }])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      fetchLinkDocument: async (links) =>
        links.length > 0
          ? {
              bytes: Buffer.from('%PDF-1.7 invoice'),
              filename: 'invoice.pdf',
              mimeType: 'application/pdf'
            }
          : null,
      store
    })

    expect(summary).toMatchObject({ downloaded: 1 })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0].localFilePath).toMatch(/__link__invoice\.pdf$/)
    expect(existsSync(store.rows[0].localFilePath!)).toBe(true)
  })

  it('extracts vendor/amount from the linked document (AI cannot read a linked file)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    // AI classified the email financial + got the vendor, but the amount lives
    // ONLY inside the linked PDF (no attachment to send to vision).
    const email = linkEmail([{ url: 'https://vendor.co/inv', text: 'לצפיה לחץ כאן' }], 'ai')
    email.extracted = { vendor: 'אלי שרותי ייעוץ בע"מ', amount: null, currency: null, date: null }

    await downloadApproved([email], {
      targetDir,
      fetchAttachment: fakeFetch(),
      fetchLinkDocument: async () => ({
        bytes: Buffer.from('%PDF-1.7'),
        filename: 'inv.pdf',
        mimeType: 'application/pdf'
      }),
      // The downloaded document's text yields the total the AI couldn't see.
      extractDocumentText: async () => 'אלי שרותי ייעוץ בע"מ\nסה"כ לתשלום: 10,620.00 ₪',
      store
    })

    expect(store.rows[0]).toMatchObject({
      vendor: 'אלי שרותי ייעוץ בע"מ', // AI's vendor kept
      amount: 10620, // filled from the linked PDF
      currency: 'ILS'
    })
  })

  it('dedups the SAME linked document arriving from several emails (thread)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    // Two different emails (message ids) carrying the identical invoice link.
    const e1 = linkEmail([{ url: 'https://vendor.co/inv', text: 'לצפיה' }])
    const e2 = linkEmail([{ url: 'https://vendor.co/inv', text: 'לצפיה' }])
    e2.email.id = 'msg-link-2'

    const summary = await downloadApproved([e1, e2], {
      targetDir,
      fetchAttachment: fakeFetch(),
      // Both links resolve to the byte-identical document.
      fetchLinkDocument: async () => ({
        bytes: Buffer.from('%PDF-1.7 identical invoice 19460'),
        filename: '513514091_DOCUMENT_1_19460.pdf',
        mimeType: 'application/pdf'
      }),
      store
    })

    // One row for the document, the duplicate counted as skipped.
    expect(store.rows).toHaveLength(1)
    expect(summary).toMatchObject({ downloaded: 1, skipped: 1 })
  })

  it('does NOT follow links when no fetcher is injected (opt-out default)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      linkEmail([{ url: 'https://vendor.co/invoice.pdf', text: 'Download invoice' }])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      store // no fetchLinkDocument → link-following off
    })

    expect(summary.downloaded).toBe(0)
    expect(store.rows).toHaveLength(0)
  })

  it('runs RONY-17 validation on a link-downloaded document (rejects junk)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [linkEmail([{ url: 'https://vendor.co/portal', text: 'View invoice' }])]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      // The link returned an HTML error page disguised as invoice.pdf.
      fetchLinkDocument: async () => ({
        bytes: Buffer.from('<!DOCTYPE html><html><body>login required</body></html>'),
        filename: 'invoice.pdf',
        mimeType: 'application/pdf'
      }),
      validateDocument,
      store
    })

    expect(summary).toMatchObject({ downloaded: 0, rejected: 1 })
    expect(store.rows).toHaveLength(0)
  })
})

describe('downloadApproved — deterministic field extraction (vendor + total)', () => {
  it('fills vendor/amount/currency on the row from the PDF text', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'inv.pdf', attachmentId: 'A1' })])]

    await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () =>
        ['אקמה שירותי ענן בע"מ', 'חשבונית מס 5567', 'מע"מ 17.00', 'סה"כ לתשלום 117.00 ₪'].join(
          '\n'
        ),
      store
    })

    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      vendor: 'אקמה שירותי ענן בע"מ',
      amount: 117,
      currency: 'ILS',
      engineType: 'deterministic'
    })
  })

  it('falls back to OCR when the document has no text layer (scan/image)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'scan.pdf', attachmentId: 'A1' })])]

    await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => '   ', // blank text layer → scanned doc
      ocrDocument: async () => 'מקסימום נוחות בע"מ סה"כ לתשלום:₪ 1,990',
      store
    })

    expect(store.rows[0]).toMatchObject({
      vendor: 'מקסימום נוחות בע"מ',
      amount: 1990,
      currency: 'ILS'
    })
  })

  it('does NOT run OCR when the text layer already yields text', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const ocr = vi.fn(async () => 'should not be used')
    const approved = [approvedEmail([att({ attachmentId: 'A1' })])]

    await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => 'Acme Ltd Total $50.00',
      ocrDocument: ocr,
      store
    })

    expect(ocr).not.toHaveBeenCalled()
    expect(store.rows[0]).toMatchObject({ vendor: 'Acme Ltd', amount: 50, currency: 'USD' })
  })

  it('leaves fields null (flagged) when the document has no extractable text (image)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([att({ filename: 'receipt.jpg', mimeType: 'image/jpeg', attachmentId: 'A1' })])
    ]

    const summary = await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      extractDocumentText: async () => null, // no OCR → images yield no text
      store
    })

    expect(summary).toMatchObject({ downloaded: 1, rejected: 0 })
    expect(store.rows[0]).toMatchObject({ vendor: null, amount: null, currency: null })
  })

  it('does NOT overwrite AI-extracted fields with the document scan', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [
      approvedEmail([att({ filename: 'inv.pdf', attachmentId: 'A1' })], {
        engineType: 'ai',
        extracted: { vendor: 'Acme Ltd', amount: 351, currency: 'ILS', date: '2026-04-30' }
      })
    ]

    await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      // Even though the document text would extract a different vendor/total, the
      // AI engine's richer fields win — deterministic extraction only fills gaps.
      extractDocumentText: async () => 'Other Vendor Inc\nTotal 999.00 USD',
      store
    })

    expect(store.rows[0]).toMatchObject({ vendor: 'Acme Ltd', amount: 351, currency: 'ILS' })
  })

  it('records the row even when no total label is found (vendor only)', async () => {
    const targetDir = tempDir()
    const store = fakeStore()
    const approved = [approvedEmail([att({ filename: 'inv.pdf', attachmentId: 'A1' })])]

    await downloadApproved(approved, {
      targetDir,
      fetchAttachment: fakeFetch(),
      // Reads like an invoice (passes the content gate) but has no total line.
      extractDocumentText: async () =>
        'Sunrise Bakery Ltd\nTax Invoice\nItem A 50.00\nItem B 70.00',
      store
    })

    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({ vendor: 'Sunrise Bakery Ltd', amount: null })
  })
})

describe('sanitizeFilename', () => {
  it('replaces illegal characters and never returns empty', () => {
    expect(sanitizeFilename('in/voice:2026?.pdf')).toBe('in_voice_2026_.pdf')
    expect(sanitizeFilename('   ')).toBe('attachment')
  })
})
