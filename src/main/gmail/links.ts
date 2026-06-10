/**
 * RONY-18 — Extracting & ranking invoice "download" links from an email.
 *
 * Many vendors don't attach the invoice; the email instead carries a link like
 * "להורדת החשבונית לחצו כאן" / "Download your invoice". The RONY-7 parser strips
 * HTML to plain text, which drops the href URLs — so we extract them here,
 * straight from the raw HTML (and from bare URLs in plain-text bodies), then
 * score them so the downloader tries the most invoice-like link first.
 *
 * Pure + dependency-free (string work only) — unit-testable in isolation. Note:
 * which links are SAFE to fetch is a separate concern (see download/urlSafety).
 */

/** A hyperlink found in an email body. */
export interface EmailLink {
  /** Absolute http(s) URL. */
  url: string
  /** Visible anchor text (for an <a>), or '' for a bare URL. */
  text: string
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}

/** Decode the handful of HTML entities that show up inside hrefs/anchor text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
}

/** Strip tags from an anchor's inner HTML and collapse whitespace. */
function anchorText(inner: string): string {
  return decodeEntities(inner.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep only absolute http(s) URLs (drop mailto:, tel:, cid:, relative, …). */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Extract `<a href>` links (url + visible text) from an HTML email body.
 * De-duplicated by URL, keeping the first non-empty anchor text seen.
 */
export function extractLinks(html: string): EmailLink[] {
  const out = new Map<string, EmailLink>()
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const url = decodeEntities(m[1]).trim()
    if (!isHttpUrl(url)) continue
    const text = anchorText(m[2])
    const existing = out.get(url)
    if (!existing) out.set(url, { url, text })
    else if (!existing.text && text) existing.text = text
  }
  return [...out.values()]
}

/** Extract bare http(s) URLs from a plain-text body (no anchor text available). */
export function extractBareUrls(text: string): EmailLink[] {
  const out = new Map<string, EmailLink>()
  const re = /https?:\/\/[^\s<>"')]+/gi
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // Trim trailing punctuation that commonly clings to URLs in prose.
    const url = m[0].replace(/[.,;:!?)\]]+$/, '')
    if (!out.has(url)) out.set(url, { url, text: '' })
  }
  return [...out.values()]
}

/* ------------------------------------------------------------------ *
 * Scoring — is a link likely an invoice/receipt DOWNLOAD link?
 * ------------------------------------------------------------------ */

/** Terms (text or URL) that suggest a document download. Edit to tune. */
const POSITIVE_TERMS = [
  'invoice',
  'receipt',
  'tax invoice',
  'bill',
  'statement',
  'download',
  'document',
  'view invoice',
  'view receipt',
  'getfile',
  'getdocument',
  // Hebrew
  'חשבונית',
  'קבלה',
  'חשבונית מס',
  'הורד',
  'להורד',
  'להורדה',
  'להורדת',
  'הורדת',
  'צפייה',
  'לצפייה',
  'צפיה', // one-yod spelling (covers לצפיה / בצפיה too via substring)
  'מסמך',
  'חיוב',
  'אסמכתא',
  'דרישת תשלום'
]

/** Terms that mark a link as definitely NOT an invoice download (hard exclude). */
const NEGATIVE_TERMS = [
  'unsubscribe',
  'opt-out',
  'optout',
  'preferences',
  'privacy',
  'terms',
  'login',
  'sign-in',
  'signin',
  'register',
  'view in browser',
  'in your browser',
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'youtube',
  'tiktok',
  'whatsapp',
  'הסרה',
  'להסרה',
  'הסרה מרשימת',
  'תנאי שימוש',
  'מדיניות פרטיות',
  'דפדפן'
]

/** True when `haystack` (already lower-cased) contains the term. */
function has(haystack: string, term: string): boolean {
  return haystack.includes(term.toLowerCase())
}

/**
 * Score a single link's invoice-likelihood. Higher is better; a score of 0 means
 * "not a candidate". A hard-negative term forces 0 even if positives also match
 * (e.g. an "unsubscribe" link that happens to sit near the word "invoice").
 */
export function scoreInvoiceLink(link: EmailLink): number {
  const url = link.url.toLowerCase()
  const text = link.text.toLowerCase()
  const hay = `${text} ${url}`

  if (NEGATIVE_TERMS.some((t) => has(hay, t))) return 0

  let score = 0
  // The anchor TEXT is the strongest signal ("download your invoice").
  for (const t of POSITIVE_TERMS) {
    if (text && has(text, t)) score += 2
    else if (has(url, t)) score += 1
  }
  // A URL that directly points at a PDF is a very strong signal.
  if (/\.pdf(\?|#|$)/i.test(url)) score += 3
  return score
}

/**
 * Rank a list of links best-first, keeping only plausible invoice-download
 * candidates (score > 0). The downloader tries them in order.
 */
export function selectInvoiceLinks(links: EmailLink[]): EmailLink[] {
  return links
    .map((link) => ({ link, score: scoreInvoiceLink(link) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.link)
}
