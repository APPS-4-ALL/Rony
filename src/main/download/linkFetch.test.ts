import { describe, expect, it } from 'vitest'
import { fetchLinkDocument, type HttpGet, type HttpResponse } from './linkFetch'
import type { EmailLink } from '../gmail/links'

const PDF = Buffer.from('%PDF-1.7\n...')

function res(over: Partial<HttpResponse>): HttpResponse {
  return { status: 200, contentType: '', body: Buffer.alloc(0), ...over }
}

/** Fake transport: route URL → response (or a thrower for blocked/error hops). */
function fakeHttp(routes: Record<string, HttpResponse | 'throw'>): HttpGet {
  return async (url) => {
    const r = routes[url]
    if (r === 'throw') throw new Error(`blocked ${url}`)
    return r ?? res({ status: 404, contentType: 'text/plain' })
  }
}

const link = (url: string, text = ''): EmailLink => ({ url, text })

describe('fetchLinkDocument — RONY-18 follow & download', () => {
  it('downloads a direct PDF link (filename from the URL path)', async () => {
    const http = fakeHttp({
      'https://v.co/files/a.pdf': res({ contentType: 'application/pdf', body: PDF })
    })
    const doc = await fetchLinkDocument([link('https://v.co/files/a.pdf', 'Download')], http)
    expect(doc).not.toBeNull()
    expect(doc!.mimeType).toBe('application/pdf')
    expect(doc!.filename).toBe('a.pdf')
    expect(doc!.bytes.equals(PDF)).toBe(true)
  })

  it('follows redirects to the document', async () => {
    const http = fakeHttp({
      'https://v.co/go': res({ status: 302, location: 'https://v.co/final.pdf' }),
      'https://v.co/final.pdf': res({ contentType: 'application/pdf', body: PDF })
    })
    const doc = await fetchLinkDocument([link('https://v.co/go', 'Invoice')], http)
    expect(doc!.mimeType).toBe('application/pdf')
  })

  it('scrapes an HTML landing page once for a document link', async () => {
    const http = fakeHttp({
      'https://v.co/landing': res({
        contentType: 'text/html',
        body: Buffer.from('<a href="https://v.co/doc.pdf">להורדת החשבונית</a>')
      }),
      'https://v.co/doc.pdf': res({ contentType: 'application/pdf', body: PDF })
    })
    const doc = await fetchLinkDocument([link('https://v.co/landing', 'View invoice')], http)
    expect(doc!.filename).toBe('doc.pdf')
  })

  it('uses the Content-Disposition filename when present', async () => {
    const http = fakeHttp({
      'https://v.co/d': res({
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="invoice-99.pdf"',
        body: PDF
      })
    })
    const doc = await fetchLinkDocument([link('https://v.co/d', 'Download invoice')], http)
    expect(doc!.filename).toBe('invoice-99.pdf')
  })

  it('refuses to follow a redirect to a non-https URL', async () => {
    const http = fakeHttp({
      'https://v.co/go': res({ status: 302, location: 'http://v.co/insecure.pdf' })
    })
    expect(await fetchLinkDocument([link('https://v.co/go', 'Invoice')], http)).toBeNull()
  })

  it('refuses to follow a redirect to a private/SSRF address', async () => {
    const http = fakeHttp({
      'https://v.co/go': res({ status: 302, location: 'https://169.254.169.254/meta.pdf' })
    })
    expect(await fetchLinkDocument([link('https://v.co/go', 'Invoice')], http)).toBeNull()
  })

  it('skips a candidate whose fetch throws and tries the next one', async () => {
    const http = fakeHttp({
      'https://v.co/bad': 'throw',
      'https://v.co/good.pdf': res({ contentType: 'application/pdf', body: PDF })
    })
    const doc = await fetchLinkDocument(
      [link('https://v.co/bad', 'Invoice'), link('https://v.co/good.pdf', 'Invoice')],
      http
    )
    expect(doc!.filename).toBe('good.pdf')
  })

  it('returns null when no link yields a document (e.g. an HTML page with no doc link)', async () => {
    const http = fakeHttp({
      'https://v.co/page': res({
        contentType: 'text/html',
        body: Buffer.from('<p>no docs here</p>')
      })
    })
    expect(await fetchLinkDocument([link('https://v.co/page', 'Invoice')], http)).toBeNull()
  })
})
