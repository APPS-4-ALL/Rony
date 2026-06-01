import { describe, it, expect } from 'vitest'
import { classifyDeterministic, INVOICE_KEYWORDS, type DeterministicInput } from './deterministic'

/** Small helper so each test only specifies the fields it cares about. */
function input(partial: Partial<DeterministicInput>): DeterministicInput {
  return { subject: '', body: '', filenames: [], ...partial }
}

describe('classifyDeterministic — RONY-9 DoD', () => {
  it('matches a fixed English string by a predefined keyword (the DoD)', () => {
    const result = classifyDeterministic(input({ subject: 'Your Invoice #1234 is ready' }))
    expect(result.isInvoice).toBe(true)
    expect(result.matchedKeywords).toContain('invoice')
  })

  it('matches a fixed Hebrew string by a predefined keyword', () => {
    const result = classifyDeterministic(input({ subject: 'מצורפת קבלה עבור התשלום' }))
    expect(result.isInvoice).toBe(true)
    expect(result.matchedKeywords).toContain('קבלה')
  })

  it('returns isInvoice=false with no matches for unrelated text', () => {
    const result = classifyDeterministic(
      input({ subject: 'Lunch tomorrow?', body: 'Want to grab a bite at noon?' })
    )
    expect(result).toEqual({ isInvoice: false, matchedKeywords: [] })
  })
})

describe('field coverage — subject, body, and filenames', () => {
  it('matches a keyword found only in the body', () => {
    const result = classifyDeterministic(input({ body: 'Please find your receipt attached.' }))
    expect(result.matchedKeywords).toContain('receipt')
  })

  it('matches a keyword found only in an attachment filename', () => {
    const result = classifyDeterministic(input({ filenames: ['Invoice_2026_03.pdf'] }))
    expect(result.matchedKeywords).toContain('invoice')
  })
})

describe('English word boundaries — no substring false positives', () => {
  it.each(['billing department', 'one billion dollars', 'unbilled hours'])(
    'does NOT match "bill" inside %j',
    (text) => {
      const result = classifyDeterministic(input({ body: text }))
      expect(result.matchedKeywords).not.toContain('bill')
    }
  )

  it('DOES match a standalone "bill"', () => {
    const result = classifyDeterministic(input({ subject: 'Your bill is overdue' }))
    expect(result.matchedKeywords).toContain('bill')
  })

  // Known limitation: a standalone homograph (the name "Bill") is a real word
  // boundary match and cannot be told apart from the noun by keywords alone.
  // Documented here so the behaviour is intentional, not a surprise. Precision
  // tuning (e.g. context/vendor heuristics) is future work, not part of RONY-9.
  it('matches the name "Bill" as a known, accepted limitation', () => {
    const result = classifyDeterministic(input({ body: 'Bill Gates keynote' }))
    expect(result.matchedKeywords).toContain('bill')
  })
})

describe('Hebrew prefixes still match (substring, no boundary)', () => {
  it('matches "חשבונית" inside the prefixed form "החשבונית"', () => {
    const result = classifyDeterministic(input({ subject: 'החשבונית שלך מוכנה' }))
    expect(result.matchedKeywords).toContain('חשבונית')
  })

  it('matches "קבלה" inside the prefixed form "וקבלה"', () => {
    const result = classifyDeterministic(input({ body: 'מצורפת חשבונית וקבלה' }))
    expect(result.matchedKeywords).toContain('קבלה')
  })
})

describe('overlapping keywords are all reported', () => {
  it('reports both "חשבונית" and "חשבונית מס" for a tax invoice', () => {
    const result = classifyDeterministic(input({ subject: 'חשבונית מס 5567' }))
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['חשבונית', 'חשבונית מס']))
  })
})

describe('keyword list hygiene', () => {
  it('has no duplicates and no untrimmed entries', () => {
    expect(new Set(INVOICE_KEYWORDS).size).toBe(INVOICE_KEYWORDS.length)
    for (const kw of INVOICE_KEYWORDS) expect(kw).toBe(kw.trim())
  })
})
