import { describe, it, expect } from 'vitest'
import { maskFile, maskId } from './log'

describe('maskFile', () => {
  it('keeps the extension and redacts the stem', () => {
    expect(maskFile('invoice_acme_2026.pdf')).toBe('i…6.pdf')
    expect(maskFile('Receipt-Jane-Doe.PNG')).toBe('R…e.PNG')
  })

  it('strips any directory and masks only the basename', () => {
    expect(maskFile('C:/Users/jane/Documents/invoice.pdf')).toBe('i…e.pdf')
    expect(maskFile('/home/jane/secret_invoice.pdf')).toBe('s…e.pdf')
  })

  it('handles short names and missing extensions', () => {
    expect(maskFile('ab.pdf')).toBe('***.pdf')
    expect(maskFile('noext')).toBe('n…t')
    expect(maskFile('')).toBe('(none)')
  })
})

describe('maskId', () => {
  it('keeps only a short prefix', () => {
    expect(maskId('18f3a9c0d1e2b3a4')).toBe('18f3a9…')
    expect(maskId('abc')).toBe('***')
    expect(maskId(null)).toBe('(none)')
    expect(maskId(undefined)).toBe('(none)')
  })
})
