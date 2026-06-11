/**
 * RONY — OCR fallback for scanned / image-only documents.
 *
 * The deterministic field extractor reads a PDF's TEXT LAYER (see extractText.ts
 * via unpdf). Many invoices, though, arrive as a photo or a scan — a JPEG/PNG, or
 * a PDF that is really just a wrapped image with no text layer. Those yield no
 * text, so vendor + total can't be read. This module fills that gap with on-device
 * OCR (tesseract.js, Hebrew + English):
 *   - an image attachment  → OCR the bytes directly,
 *   - a text-less PDF      → render page 1 to a PNG (unpdf + @napi-rs/canvas), OCR that.
 *
 * SCOPE — used ONLY to populate vendor/amount, never the RONY-17 content gate:
 * OCR output is noisy, so it must not be able to REJECT a document (that stays
 * driven by the reliable native text layer). Worst case here is a blank field.
 *
 * Cost: OCR is slow (seconds per page) and CPU-bound, so a single worker is
 * shared and recognitions are serialised. Never throws — any failure resolves to
 * `null`, and the caller simply leaves the fields empty (flagged for review).
 */
import { createWorker, type Worker } from 'tesseract.js'
import { renderPageAsImage } from 'unpdf'
import { MAX_PARSE_BYTES } from '../../shared/limits'
import { logger, maskFile } from '../lib/log'

/** Image extensions we OCR directly (mirrors the RONY-7 allowlist). */
const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif'
])

/**
 * Hard ceiling on a single OCR recognition. Tesseract can hang on pathological
 * input (a huge or adversarial image); with no deadline that pins a CPU core
 * indefinitely and — because recognitions are serialised on one worker — blocks
 * every later OCR behind it. On timeout we abandon the job and recycle the
 * worker (see ocrDocument) so the queue keeps moving.
 */
const OCR_TIMEOUT_MS = 30_000

/** Distinct error so the timeout path can be told apart from a normal failure. */
class OcrTimeoutError extends Error {
  constructor() {
    super(`OCR timed out after ${OCR_TIMEOUT_MS}ms`)
    this.name = 'OcrTimeoutError'
  }
}

/** Where tesseract caches the (downloaded-once) language data. Set by the wiring. */
let cacheDir: string | undefined

/** Point OCR at a writable cache dir for its language data (call once at startup). */
export function configureOcr(opts: { cacheDir?: string }): void {
  cacheDir = opts.cacheDir
}

/** Lazily-created, reused worker — creating one is expensive (loads ~15MB of langs). */
let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // 'heb+eng' covers Israeli invoices (mixed Hebrew/English); OEM 1 = LSTM.
    workerPromise = createWorker('heb+eng', 1, { cachePath: cacheDir, gzip: true }).catch((e) => {
      workerPromise = null // let a later call retry a fresh worker
      throw e
    })
  }
  return workerPromise
}

/** Serialise recognitions: OCR is heavy, so we never run two at once. */
let tail: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn)
  // Keep the chain alive regardless of individual success/failure.
  tail = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function extensionOf(filename: string): string {
  return filename.toLowerCase().split('.').pop() ?? ''
}

/** Turn a document into a single image (Buffer) for OCR, or null if unsupported. */
async function toImage(doc: {
  filename: string
  mimeType: string
  bytes: Buffer
}): Promise<Buffer | null> {
  const ext = extensionOf(doc.filename)
  const mime = doc.mimeType.toLowerCase()

  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) {
    return doc.bytes
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    // Render the first page to a PNG at 2× for legible OCR. In Node, unpdf needs
    // the canvas implementation passed explicitly (@napi-rs/canvas — prebuilt
    // native, no compile step).
    const png = await renderPageAsImage(new Uint8Array(doc.bytes), 1, {
      scale: 2,
      canvasImport: () => import('@napi-rs/canvas')
    })
    return Buffer.from(png)
  }

  return null
}

/**
 * OCR a downloaded document and return its text, or `null` when there is nothing
 * to OCR (unsupported type) or OCR fails. Safe to call for every document — it
 * only does real work for images and PDFs.
 */
export async function ocrDocument(doc: {
  filename: string
  mimeType: string
  bytes: Buffer
}): Promise<string | null> {
  try {
    // DoS guard: OCR (and the PDF→PNG render that precedes it) is the most
    // CPU/memory-hungry path in the app. Refuse oversized input outright so a
    // crafted huge image / PDF can't pin a core. The file is still kept; we just
    // leave vendor/amount empty (flagged for review).
    if (doc.bytes.length > MAX_PARSE_BYTES) {
      logger.warn(
        `[ocr] skipping ${maskFile(doc.filename)}: ${doc.bytes.length} bytes exceeds ` +
          `${MAX_PARSE_BYTES}-byte parse cap`
      )
      return null
    }
    const image = await toImage(doc)
    if (!image) return null
    const text = await enqueue(async () => {
      const worker = await getWorker()
      const recognition = worker.recognize(image).then(({ data }) => data.text)
      // The recognition may settle AFTER we've timed out and recycled the worker;
      // swallow that late result/rejection so it never surfaces as an unhandled
      // rejection.
      recognition.catch(() => undefined)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OcrTimeoutError()), OCR_TIMEOUT_MS)
      })
      try {
        return await Promise.race([recognition, timeout])
      } catch (e) {
        // A hung recognition leaves the shared worker stuck on a zombie job;
        // tear it down so the NEXT document gets a fresh worker instead of
        // queueing behind the wedged one.
        if (e instanceof OcrTimeoutError) await terminateOcr()
        throw e
      } finally {
        if (timer) clearTimeout(timer)
      }
    })
    return text && text.trim().length > 0 ? text : null
  } catch (e) {
    logger.warn(`[ocr] failed for ${maskFile(doc.filename)}:`, e)
    return null
  }
}

/** Tear down the shared worker (call on app quit so no child process lingers). */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return
  const pending = workerPromise
  workerPromise = null
  try {
    await (await pending).terminate()
  } catch {
    /* already gone */
  }
}
