import { describe, it, expect } from 'vitest'
import { redactPii } from './redact'

describe('redactPii', () => {
  it('masks Israeli + international phone numbers', () => {
    expect(redactPii("טל' 03-7659600")).toBe("טל' [PHONE]")
    expect(redactPii('נייד 052-1234567')).toBe('נייד [PHONE]')
    expect(redactPii('0521234567')).toBe('[PHONE]')
    expect(redactPii('+972-52-123-4567')).toBe('[PHONE]')
  })

  it('masks email addresses', () => {
    expect(redactPii('צרו קשר: a.b_c@amanet.co.il כאן')).toBe('צרו קשר: [EMAIL] כאן')
  })

  it('masks labelled account, IBAN, and national-ID numbers', () => {
    expect(redactPii('ע"ח 12-345-678901')).toBe('ע"ח [ACCOUNT]')
    expect(redactPii('ת.ז 040578234')).toBe('ת.ז [ID]')
    expect(redactPii('IBAN IL620108000000099999999')).toContain('[ACCOUNT]')
  })

  it('masks a grouped card number', () => {
    expect(redactPii('כרטיס 4580 1234 5678 9012')).toBe('כרטיס [CARD]')
  })

  it('masks any other long (9+) digit run', () => {
    expect(redactPii('מספר לקוח 123456789')).toBe('מספר לקוח [NUMBER]')
  })

  // The critical guarantee: redaction must NEVER touch the invoice fields.
  it('preserves amounts, currency, and ISO dates', () => {
    const text = 'סה"כ לתשלום 1,200 ש"ח  בתאריך 2026-05-07'
    expect(redactPii(text)).toBe(text)
    expect(redactPii('Total: 1,234.50 ILS on 2026-01-31')).toBe('Total: 1,234.50 ILS on 2026-01-31')
    expect(redactPii('סכום: 99.90 ₪')).toBe('סכום: 99.90 ₪')
  })

  it('reproduces the approved multi-line example', () => {
    const before = [
      "טל' 03-7659600, נייד 052-1234567",
      'ע"ח 12-345-678901  ת.ז 040578234',
      'סה"כ לתשלום 1,200 ש"ח  בתאריך 2026-05-07'
    ].join('\n')
    const after = [
      "טל' [PHONE], נייד [PHONE]",
      'ע"ח [ACCOUNT]  ת.ז [ID]',
      'סה"כ לתשלום 1,200 ש"ח  בתאריך 2026-05-07'
    ].join('\n')
    expect(redactPii(before)).toBe(after)
  })

  it('returns empty/whitespace input unchanged', () => {
    expect(redactPii('')).toBe('')
    expect(redactPii('   ')).toBe('   ')
  })
})
