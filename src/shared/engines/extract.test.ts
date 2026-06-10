import { describe, it, expect } from 'vitest'
import {
  extractInvoiceFields,
  parseAmount,
  detectCurrency,
  type ExtractedInvoiceFields
} from './extract'

/* ------------------------------------------------------------------ *
 * parseAmount — separator-convention normalisation.
 * ------------------------------------------------------------------ */
describe('parseAmount', () => {
  it.each([
    ['1,234.56', 1234.56], // comma thousands, dot decimal (IL/US)
    ['1.234,56', 1234.56], // dot thousands, comma decimal (EU)
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    ['100,50', 100.5], // single comma as decimal
    ['1234.5', 1234.5],
    ['1,234', 1234], // single comma, 3 trailing digits → thousands
    ['999', 999],
    ['0.99', 0.99]
  ])('parses %s → %d', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected)
  })

  it('returns null for non-numeric input', () => {
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * detectCurrency.
 * ------------------------------------------------------------------ */
describe('detectCurrency', () => {
  it.each([
    ['Total: ₪1,234', 'ILS'],
    ['סה"כ 1,234 ש"ח', 'ILS'],
    ['Total $99.00', 'USD'],
    ['Amount due 50 USD', 'USD'],
    ['Total €10', 'EUR'],
    ['Total £10', 'GBP']
  ])('detects %s → %s', (text, code) => {
    expect(detectCurrency(text)).toBe(code)
  })

  it('returns null when no currency is present', () => {
    expect(detectCurrency('Total 1234')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * extractInvoiceFields.
 *
 * Inputs are written as ONE line on purpose: a PDF text-layer extracted by
 * unpdf is a single space-joined stream (no newlines), so these mirror the real
 * shape the engine must cope with. The cases are distilled from real invoices.
 * ------------------------------------------------------------------ */

function expectFields(text: string, expected: Partial<ExtractedInvoiceFields>): void {
  expect(extractInvoiceFields(text)).toMatchObject(expected)
}

describe('extractInvoiceFields — amount (label-anchored, linear text)', () => {
  it('reads a grand total over a subtotal and VAT line', () => {
    // Anthropic-style: IL VAT id sits right beside a "$" — must NOT be picked.
    const text = 'Anthropic, PBC IL VAT 513514091 Subtotal $5.00 Total $5.00 Amount due $5.00 USD'
    expectFields(text, { amount: 5, currency: 'USD' })
  })

  it('does not grab the VAT amount sitting next to the total', () => {
    expectFields('עסק קטן בע"מ מע"מ 18.00 סה"כ 118.00 ₪', { amount: 118, currency: 'ILS' })
  })

  it('prefers "Amount Due" (strong) over a bare "Total"', () => {
    expectFields('Globex Inc Total 500.00 Amount Due 450.00 USD', { amount: 450, currency: 'USD' })
  })

  it('ignores the Subtotal and VAT, takes "Total Due"', () => {
    expectFields('Initech LLC Subtotal 200.00 VAT 34.00 Total Due 234.00', { amount: 234 })
  })

  it('reads the Hebrew סה״כ total with ₪', () => {
    expectFields('מקסימום נוחות בע"מ מע"מ 18.0 סה"כ לתשלום:₪ 1,990', {
      amount: 1990,
      currency: 'ILS'
    })
  })

  it('reads "לתשלום" as a strong label', () => {
    expectFields('חנות הספרים בע"מ סה"כ 200.00 לתשלום 234.00 ש"ח', { amount: 234, currency: 'ILS' })
  })

  it('reads "Total in EUR" with a € amount', () => {
    expectFields('Google Cloud EMEA Limited Subtotal in EUR €48.60 VAT (0%) Total in EUR €48.60', {
      amount: 48.6,
      currency: 'EUR'
    })
  })
})

describe('extractInvoiceFields — vendor (company-suffix, linear text)', () => {
  it('reads an English company name from its suffix', () => {
    expectFields('Slack Technologies Limited 500 Howard Street Total $435.00', {
      vendor: 'Slack Technologies Limited'
    })
  })

  it('keeps a comma inside the name (Anthropic, PBC)', () => {
    expectFields('Page 1 of 1 Invoice Anthropic, PBC 548 Market Street Amount due $5.00', {
      vendor: 'Anthropic, PBC'
    })
  })

  it('reads a Hebrew company name ending in בע״מ', () => {
    expectFields('מקסימום נוחות בע"מ ח.פ 515569440 סה"כ 1,990.00 ₪', {
      vendor: 'מקסימום נוחות בע"מ'
    })
  })

  it('strips boilerplate words before the name ("Total in EUR Google …")', () => {
    expectFields('VAT (0%) Total in EUR Google Cloud EMEA Limited Dublin', {
      vendor: 'Google Cloud EMEA Limited'
    })
  })

  it('skips the customer after a "Bill to" marker, prefers the issuer', () => {
    const text = 'Anthropic, PBC support@anthropic.com Bill to elie consulting ltd Total $5.00'
    expectFields(text, { vendor: 'Anthropic, PBC' })
  })
})

describe('extractInvoiceFields — flagging (null) behaviour', () => {
  it('returns null amount when no total label is present (no blind guessing)', () => {
    const result = extractInvoiceFields('Acme Ltd Order #998877 Item A 50.00 Item B 70.00')
    expect(result.amount).toBeNull()
  })

  it('returns null amount when the "סכום" field is empty (generated email body)', () => {
    // The amount field is blank; the only number is the message date.
    expectFields('שרותי ייעוץ בע"מ 2026-05-16 תאריך:— סכום: please send to accounting', {
      amount: null
    })
  })

  it('returns all-null for empty text', () => {
    expect(extractInvoiceFields('')).toEqual({ vendor: null, amount: null, currency: null })
    expect(extractInvoiceFields('   \n  ')).toEqual({
      vendor: null,
      amount: null,
      currency: null
    })
  })

  it('does not grab a long account/VAT number as the amount', () => {
    expect(extractInvoiceFields('Acme Ltd Account 123456789012 No total here').amount).toBeNull()
  })
})
