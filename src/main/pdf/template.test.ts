import { describe, it, expect } from 'vitest'
import { buildReceiptHtml, escapeHtml, PROVENANCE_NOTICE } from './template'

describe('escapeHtml', () => {
  it('neutralizes HTML so an email body can never inject markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapeHtml('a & "b"')).toBe('a &amp; &quot;b&quot;')
  })
})

describe('buildReceiptHtml', () => {
  const data = {
    vendor: 'Animal Express',
    amount: 64,
    currency: 'ILS',
    date: '2026-05-30',
    body: 'סך הכל: 64'
  }

  it('includes the vendor, formatted amount, date, body, and the provenance notice', () => {
    const html = buildReceiptHtml(data)
    expect(html).toContain('Animal Express')
    expect(html).toContain('64.00 ILS')
    expect(html).toContain('2026-05-30')
    expect(html).toContain('סך הכל: 64')
    expect(html).toContain(PROVENANCE_NOTICE)
    expect(html).toContain('dir="rtl"')
  })

  it('escapes a malicious body instead of rendering it (B1 safety)', () => {
    const html = buildReceiptHtml({ ...data, body: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})
