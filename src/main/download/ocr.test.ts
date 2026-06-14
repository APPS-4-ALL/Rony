import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MAX_PARSE_BYTES } from '../../shared/limits'

/* Shared mock handles for the tesseract worker. The createWorker mock returns
 * these same references every call, so the tests can drive `recognize` and
 * assert on `terminate` (worker recycling). */
const recognize = vi.fn()
const terminate = vi.fn(async () => undefined)

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn(async () => ({ recognize, terminate }))
}))

// unpdf is only reached for the PDF→PNG path; stub it so importing ./ocr never
// pulls in the real (heavy, native) renderer.
vi.mock('unpdf', () => ({
  renderPageAsImage: vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
}))

import { ocrDocument, terminateOcr } from './ocr'
import { createWorker } from 'tesseract.js'

const img = (
  over: Partial<{ filename: string; mimeType: string; bytes: Buffer }> = {}
): {
  filename: string
  mimeType: string
  bytes: Buffer
} => ({ filename: 'receipt.png', mimeType: 'image/png', bytes: Buffer.from('img-bytes'), ...over })

beforeEach(() => {
  recognize.mockReset()
  terminate.mockReset()
  terminate.mockResolvedValue(undefined)
  ;(createWorker as unknown as ReturnType<typeof vi.fn>).mockClear()
})

afterEach(async () => {
  // Reset the module-level shared worker so each test starts fresh.
  await terminateOcr()
  vi.useRealTimers()
})

describe('ocrDocument', () => {
  it('returns recognised text for an image attachment', async () => {
    recognize.mockResolvedValue({ data: { text: '  Invoice total 100 ILS  ' } })
    const out = await ocrDocument(img({ filename: 'r.jpg', mimeType: 'image/jpeg' }))
    expect(out).toBe('  Invoice total 100 ILS  ')
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('returns null when OCR yields only whitespace', async () => {
    recognize.mockResolvedValue({ data: { text: '   \n  ' } })
    expect(await ocrDocument(img())).toBeNull()
  })

  it('skips input larger than the parse cap without invoking OCR', async () => {
    const out = await ocrDocument(
      img({ filename: 'big.png', bytes: Buffer.alloc(MAX_PARSE_BYTES + 1) })
    )
    expect(out).toBeNull()
    expect(recognize).not.toHaveBeenCalled()
  })

  it('returns null for an unsupported document type', async () => {
    const out = await ocrDocument({
      filename: 'note.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('hello')
    })
    expect(out).toBeNull()
    expect(recognize).not.toHaveBeenCalled()
  })

  it('times out a hung recognition, recovers to null, and recycles the worker', async () => {
    vi.useFakeTimers()
    recognize.mockReturnValue(new Promise(() => {})) // never settles → simulates a hang

    const pending = ocrDocument(img({ filename: 'hang.png' }))
    await vi.advanceTimersByTimeAsync(30_000) // cross the OCR_TIMEOUT_MS deadline

    await expect(pending).resolves.toBeNull()
    // The wedged worker is torn down so the next document isn't stuck behind it.
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('serves a later document on a fresh worker after a timeout', async () => {
    vi.useFakeTimers()
    recognize.mockReturnValueOnce(new Promise(() => {})) // first call hangs
    const first = ocrDocument(img({ filename: 'hang.png' }))
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(first).resolves.toBeNull()
    vi.useRealTimers()

    recognize.mockResolvedValueOnce({ data: { text: 'Recovered invoice 42' } })
    const second = await ocrDocument(img({ filename: 'ok.png' }))
    expect(second).toBe('Recovered invoice 42')
    // A new worker was created for the second call (the first was recycled).
    expect(createWorker).toHaveBeenCalledTimes(2)
  })
})
