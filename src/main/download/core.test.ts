import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadApproved, sanitizeFilename, type ApprovedEmail, type InvoiceStore } from './core'
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
    ...over
  }
}

function approvedEmail(
  attachments: GmailAttachmentRef[],
  over: Partial<ApprovedEmail> = {}
): ApprovedEmail {
  const email: ParsedEmail = {
    id: 'msg1',
    threadId: null,
    subject: 'חשבונית מס',
    from: 'vendor@x.co.il',
    date: '2026-05-01',
    snippet: '',
    bodyText: '',
    attachments
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

    expect(summary).toEqual({ downloaded: 2, skipped: 0, errors: 0 })

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
      approvedEmail([], {
        engineType: 'ai',
        extracted: { vendor: 'Animal Express', amount: 64, currency: 'ILS', date: '2026-05-30' }
      })
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
      vendor: 'Animal Express',
      amount: 64,
      engineType: 'ai'
    })
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

describe('sanitizeFilename', () => {
  it('replaces illegal characters and never returns empty', () => {
    expect(sanitizeFilename('in/voice:2026?.pdf')).toBe('in_voice_2026_.pdf')
    expect(sanitizeFilename('   ')).toBe('attachment')
  })
})
