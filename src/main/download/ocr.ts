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
    const image = await toImage(doc)
    if (!image) return null
    const text = await enqueue(async () => {
      const worker = await getWorker()
      const { data } = await worker.recognize(image)
      return data.text
    })
    return text && text.trim().length > 0 ? text : null
  } catch (e) {
    console.warn(`[ocr] failed for ${doc.filename}:`, e)
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
