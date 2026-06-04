/**
 * Pure HTML template for a generated receipt PDF (no Electron/Node imports, so
 * it's unit-testable). The email body is HTML-ESCAPED before insertion, so even
 * a malicious message body renders as plain text — never as markup/script.
 */

export interface EmailPdfData {
  vendor: string | null
  amount: number | null
  currency: string | null
  /** ISO date (YYYY-MM-DD) shown in the header. */
  date: string | null
  /** The email's plain-text body. */
  body: string
}

/** Escape text so anything in the email renders as text, never as HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Format the amount + currency for the header, or an em dash. */
function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  const n = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${n} ${currency}` : n
}

/** The provenance footer — makes clear this is NOT the vendor's original file. */
export const PROVENANCE_NOTICE =
  'מסמך זה הופק אוטומטית מתוכן הודעת הדואר האלקטרוני על-ידי רוני, ואינו המסמך המקורי שהונפק על-ידי הספק.'

/** Build the self-contained, RTL HTML for one receipt. */
export function buildReceiptHtml(d: EmailPdfData): string {
  const vendor = escapeHtml(d.vendor ?? 'חשבונית')
  const date = escapeHtml(d.date ?? '—')
  const amount = escapeHtml(formatAmount(d.amount, d.currency))
  const body = escapeHtml(d.body)
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px 36px; }
  .head { border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 18px; }
  .vendor { font-size: 22px; font-weight: 700; }
  .meta { margin-top: 8px; display: flex; gap: 28px; font-size: 13px; color: #475569; }
  .meta b { color: #0f172a; font-weight: 600; }
  .amount { color: #047857; }
  .body { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.7; color: #1e293b; }
  .notice { margin-top: 28px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="head">
    <div class="vendor">${vendor}</div>
    <div class="meta">
      <span>תאריך: <b>${date}</b></span>
      <span>סכום: <b class="amount">${amount}</b></span>
    </div>
  </div>
  <div class="body">${body}</div>
  <div class="notice">${PROVENANCE_NOTICE}</div>
</body>
</html>`
}
