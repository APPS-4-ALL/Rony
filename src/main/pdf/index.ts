/**
 * Render a body-only receipt (an email with no attached invoice file) into a
 * real PDF, so it becomes a first-class invoice: openable, exportable, and
 * hand-off-able to an accountant like any other.
 *
 * Strategy "B1": we DON'T render the email's original HTML (untrusted, pulls
 * remote tracking pixels, can hang/leak). Instead we drop the already-stripped
 * plain text into our OWN clean, RTL template (see ./template) and print it with
 * Electron's built-in `webContents.printToPDF()` — Chromium under the hood, so
 * zero extra deps and perfect Hebrew/Unicode.
 */
import { BrowserWindow } from 'electron'
import { buildReceiptHtml, type EmailPdfData } from './template'

export type { EmailPdfData } from './template'

/**
 * Hard ceiling for one PDF render. Chromium can hang on a pathological page; an
 * un-timed `await` would stall the WHOLE scan forever. On timeout we reject so
 * the caller falls back to a file-less row (the fallback already exists).
 */
const RENDER_TIMEOUT_MS = 8000

/** Reject if `promise` doesn't settle within `ms` (the timer is always cleared). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Render the receipt HTML to PDF bytes in a throwaway offscreen window (no Node,
 * no JS, no network — it only displays our static, escaped template). Both the
 * load and the print are bounded by {@link RENDER_TIMEOUT_MS}.
 */
export async function renderEmailPdf(data: EmailPdfData): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: false // our template is static; disabling JS is belt-and-suspenders
    }
  })
  try {
    const html = buildReceiptHtml(data)
    await withTimeout(
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
      RENDER_TIMEOUT_MS,
      'PDF load'
    )
    return await withTimeout(
      win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }),
      RENDER_TIMEOUT_MS,
      'PDF print'
    )
  } finally {
    win.destroy()
  }
}
