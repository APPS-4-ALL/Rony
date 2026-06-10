import { describe, expect, it } from 'vitest'
import {
  extractBareUrls,
  extractLinks,
  scoreInvoiceLink,
  selectInvoiceLinks,
  type EmailLink
} from './links'

describe('extractLinks — <a href> from HTML', () => {
  it('pulls url + visible text and decodes entities in the href', () => {
    const html = '<p>hello</p><a href="https://vendor.co.il/inv?id=1&amp;t=2">להורדת החשבונית</a>'
    expect(extractLinks(html)).toEqual([
      { url: 'https://vendor.co.il/inv?id=1&t=2', text: 'להורדת החשבונית' }
    ])
  })

  it('strips inner tags from the anchor text', () => {
    const html = '<a href="https://x.co/d"><b>Download</b> your <i>invoice</i></a>'
    expect(extractLinks(html)[0].text).toBe('Download your invoice')
  })

  it('keeps only http(s) and de-dupes by URL (first non-empty text wins)', () => {
    const html =
      '<a href="mailto:x@y.com">mail</a>' +
      '<a href="https://x.co/a"></a>' +
      '<a href="https://x.co/a">Invoice</a>'
    expect(extractLinks(html)).toEqual([{ url: 'https://x.co/a', text: 'Invoice' }])
  })
})

describe('extractBareUrls — URLs in plain text', () => {
  it('finds urls and trims trailing punctuation', () => {
    const text = 'Download here: https://vendor.com/invoice/55.pdf. Thanks!'
    expect(extractBareUrls(text)).toEqual([{ url: 'https://vendor.com/invoice/55.pdf', text: '' }])
  })
})

describe('scoreInvoiceLink / selectInvoiceLinks', () => {
  const link = (url: string, text = ''): EmailLink => ({ url, text })

  it('scores invoice-ish links above zero and a direct PDF highest', () => {
    expect(scoreInvoiceLink(link('https://x.co/files/a.pdf'))).toBeGreaterThan(0)
    expect(scoreInvoiceLink(link('https://x.co/go', 'להורדת החשבונית'))).toBeGreaterThan(0)
    expect(scoreInvoiceLink(link('https://x.co/home', 'Read our blog'))).toBe(0)
  })

  it('matches both Hebrew spellings of "view" (צפיה / צפייה), incl. לצפיה', () => {
    expect(scoreInvoiceLink(link('https://x.co/go', 'לצפיה לחץ כאן'))).toBeGreaterThan(0) // one yod
    expect(scoreInvoiceLink(link('https://x.co/go', 'לצפייה במסמך'))).toBeGreaterThan(0) // two yods
  })

  it('hard-excludes unsubscribe/social links even if "invoice" appears nearby', () => {
    expect(scoreInvoiceLink(link('https://x.co/unsubscribe?ref=invoice', 'invoice'))).toBe(0)
    expect(scoreInvoiceLink(link('https://facebook.com/vendor', 'Invoice'))).toBe(0)
  })

  it('ranks candidates best-first and drops non-candidates', () => {
    const links = [
      link('https://x.co/unsubscribe', 'unsubscribe'),
      link('https://x.co/view', 'view invoice'),
      link('https://x.co/inv.pdf', 'Download'),
      link('https://x.co/about', 'about us')
    ]
    const ranked = selectInvoiceLinks(links)
    expect(ranked[0].url).toBe('https://x.co/inv.pdf') // pdf + download terms
    expect(ranked.map((l) => l.url)).not.toContain('https://x.co/unsubscribe')
    expect(ranked.map((l) => l.url)).not.toContain('https://x.co/about')
  })
})
