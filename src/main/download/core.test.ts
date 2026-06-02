import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadApproved, sanitizeFilename, type ApprovedEmail, type InvoiceStore } from './core'
import type { NewInvoice } from '../../shared/types'
import type { GmailAttachmentRef, ParsedEmail } from '../gmail/parse'

/** In-memory store that records inserts, so we can assert on the DB rows. */
function fakeStore(): InvoiceStore & { rows: NewInvoice[] } {
  const rows: NewInvoice[] = []
  return {
    rows,
    existsByPath: (path) => rows.some((r) => r.localFilePath === path),
    insert: (invoice) => {
      rows.push(invoice)
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

    // Files exist on disk...
    const pdfPath = join(targetDir, 'msg1__invoice.pdf')
    const imgPath = join(targetDir, 'msg1__receipt.jpg')
    expect(existsSync(pdfPath)).toBe(true)
    expect(existsSync(imgPath)).toBe(true)
    expect(readFileSync(pdfPath).toString()).toBe('bytes-for-A1')

    // ...and a SQLite-bound row was recorded for each, carrying the file path.
    expect(store.rows).toHaveLength(2)
    expect(store.rows[0]).toMatchObject({
      messageId: 'msg1',
      localFilePath: pdfPath,
      status: 'downloaded',
      engineType: 'deterministic'
    })
  })

  it('is idempotent — a second run skips already-recorded files (dedup)', async () => {
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
