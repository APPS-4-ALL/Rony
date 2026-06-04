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
 * Render the receipt HTML to PDF bytes in a throwaway offscreen window (no Node,
 * no JS, no network — it only displays our static, escaped template).
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
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    win.destroy()
  }
}
