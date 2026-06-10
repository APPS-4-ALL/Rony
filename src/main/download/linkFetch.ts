/**
 * RONY-18 — Following an invoice link and downloading the document.
 *
 * Strategy (no headless browser): for each candidate link, GET it; follow
 * redirects; if the response IS a document (PDF/image/office) download it. If it
 * is an HTML landing page, scrape THAT page once for a direct document link and
 * try it. Everything fetched still flows through RONY-17 validation upstream.
 *
 * The orchestration ({@link fetchLinkDocument}) is pure given an injected
 * `httpGet`, so it unit-tests with a fake transport. The real transport
 * ({@link createSafeHttpGet}) is the security boundary: https-only, DNS pinned to
 * a validated public IP (no SSRF / rebinding), no cookies, size cap, timeout.
 */
import { request } from 'node:https'
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { extractBareUrls, extractLinks, selectInvoiceLinks, type EmailLink } from '../gmail/links'
import { INVOICE_DOC_EXTENSIONS } from '../gmail/parse'
import { checkFetchableUrl, isPrivateIp } from './urlSafety'

/** A document fetched from a link, ready for the same handling as an attachment. */
export interface FetchedDocument {
  bytes: Buffer
  filename: string
  mimeType: string
}

/** One HTTP response (a single hop — the caller follows redirects). */
export interface HttpResponse {
  status: number
  /** Lower-cased content-type without parameters, e.g. 'application/pdf'. */
  contentType: string
  /** Raw `Content-Disposition`, if present (used to recover a filename). */
  contentDisposition?: string
  /** `Location` header for a 3xx, if present. */
  location?: string
  /** Response body (empty for redirects). */
  body: Buffer
}

/** Perform ONE GET (no redirect following) and return the response. */
export type HttpGet = (url: string) => Promise<HttpResponse>

/** Content-types we treat as a downloadable document. */
const DOCUMENT_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
])

const MAX_REDIRECTS = 5
const MAX_CANDIDATES = 4
/** Hard caps for the real transport. */
const MAX_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 15_000

/** Decide what a response body IS, from its content-type (falling back to the URL extension). */
function classifyContent(contentType: string, url: string): 'document' | 'html' | 'other' {
  if (DOCUMENT_CONTENT_TYPES.has(contentType) || contentType.startsWith('image/')) return 'document'
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return 'html'
  // A generic/empty type that still points at a known document extension counts.
  const ext = new URL(url).pathname.toLowerCase().split('.').pop() ?? ''
  if (
    (contentType === '' || contentType === 'application/octet-stream') &&
    INVOICE_DOC_EXTENSIONS.includes(ext)
  ) {
    return 'document'
  }
  return 'other'
}

/** Recover a filename from Content-Disposition, else the URL path, else a default. */
function filenameFromResponse(res: HttpResponse, url: string): string {
  const cd = res.contentDisposition ?? ''
  const star = /filename\*\s*=\s*(?:UTF-8'')?["']?([^"';]+)/i.exec(cd)
  const plain = /filename\s*=\s*["']?([^"';]+)/i.exec(cd)
  const fromCd = star?.[1] ?? plain?.[1]
  if (fromCd) {
    try {
      return decodeURIComponent(fromCd.trim())
    } catch {
      return fromCd.trim()
    }
  }
  const base = new URL(url).pathname.split('/').filter(Boolean).pop()
  if (base && base.includes('.')) return decodeURIComponent(base)
  // Fall back to an extension implied by the content-type.
  if (res.contentType === 'application/pdf') return 'invoice.pdf'
  if (res.contentType.startsWith('image/')) return `invoice.${res.contentType.split('/')[1]}`
  return 'invoice-download'
}

/** Follow one start URL through redirects to a document, optionally scraping one HTML page. */
async function resolveToDocument(
  startUrl: string,
  httpGet: HttpGet,
  allowScrape: boolean
): Promise<FetchedDocument | null> {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkFetchableUrl(url)
    if (!check.ok) return null

    let res: HttpResponse
    try {
      res = await httpGet(url)
    } catch {
      return null // blocked address, timeout, TLS error, oversize — all non-fatal
    }

    if (res.status >= 300 && res.status < 400 && res.location) {
      url = new URL(res.location, url).toString() // resolve relative redirects
      continue
    }
    if (res.status !== 200) return null

    const kind = classifyContent(res.contentType, url)
    if (kind === 'document') {
      return {
        bytes: res.body,
        filename: filenameFromResponse(res, url),
        mimeType: res.contentType
      }
    }
    if (kind === 'html' && allowScrape) {
      const html = res.body.toString('utf-8')
      const candidates = selectInvoiceLinks([...extractLinks(html), ...extractBareUrls(html)])
      for (const c of candidates.slice(0, MAX_CANDIDATES)) {
        const abs = new URL(c.url, url).toString()
        const doc = await resolveToDocument(abs, httpGet, false) // scrape only one level deep
        if (doc) return doc
      }
    }
    return null
  }
  return null // too many redirects
}

/**
 * Try the ranked invoice links until one yields a document, or null if none do.
 * Each link is followed through redirects, with a single HTML-scrape fallback.
 */
export async function fetchLinkDocument(
  candidates: EmailLink[],
  httpGet: HttpGet
): Promise<FetchedDocument | null> {
  for (const link of candidates.slice(0, MAX_CANDIDATES)) {
    const doc = await resolveToDocument(link.url, httpGet, true)
    if (doc) return doc
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Real transport — the security boundary. Not unit-tested (needs the network);
 * its safety primitives (urlSafety) and orchestration (above) are.
 * ------------------------------------------------------------------ */

/** A `dns.lookup` replacement that rejects resolution to a private/reserved IP. */
function safeLookup(
  hostname: string,
  options: Parameters<typeof dnsLookup>[1],
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
): void {
  dnsLookup(hostname, options as object, (err, address, family) => {
    if (err) return callback(err, address as string, family)
    if (Array.isArray(address)) {
      const safe = address.filter((a) => !isPrivateIp(a.address))
      if (safe.length === 0) {
        return callback(new Error(`blocked: ${hostname} resolves only to private addresses`), [])
      }
      return callback(null, safe)
    }
    if (isPrivateIp(address as string)) {
      return callback(new Error(`blocked: ${hostname} resolved to private address ${address}`), '')
    }
    callback(null, address as string, family)
  })
}

/**
 * The real {@link HttpGet}: a single https GET with the full safety posture —
 * IP pinned to a validated public address (the connection uses the SAME IP we
 * checked, defeating DNS rebinding), no cookies/credentials, a body-size cap and
 * a timeout. Redirects are NOT followed here; the caller re-vets each hop.
 */
export function createSafeHttpGet(): HttpGet {
  return (url: string) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const req = request(
        url,
        {
          method: 'GET',
          timeout: TIMEOUT_MS,
          lookup: safeLookup as unknown as undefined,
          headers: {
            'User-Agent': 'Rony-Invoice-Scanner',
            Accept: 'application/pdf,image/*,application/octet-stream,*/*'
          }
        },
        (res) => {
          const status = res.statusCode ?? 0
          const contentType = String(res.headers['content-type'] ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase()
          const contentDisposition = res.headers['content-disposition'] as string | undefined
          const location = res.headers['location'] as string | undefined

          if (status >= 300 && status < 400) {
            res.resume() // discard any redirect body
            resolve({ status, contentType, contentDisposition, location, body: Buffer.alloc(0) })
            return
          }

          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_BYTES) {
              req.destroy(new Error('response exceeds size cap'))
              return
            }
            chunks.push(c)
          })
          res.on('end', () =>
            resolve({
              status,
              contentType,
              contentDisposition,
              location,
              body: Buffer.concat(chunks)
            })
          )
          res.on('error', reject)
        }
      )
      req.on('timeout', () => req.destroy(new Error('request timed out')))
      req.on('error', reject)
      req.end()
    })
}
