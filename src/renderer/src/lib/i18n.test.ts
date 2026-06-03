import { describe, it, expect } from 'vitest'
import { translate, dirForLocale, messages, LOCALE_OPTIONS } from './i18n'

describe('dirForLocale', () => {
  it('maps Hebrew to RTL and English to LTR', () => {
    expect(dirForLocale('he')).toBe('rtl')
    expect(dirForLocale('en')).toBe('ltr')
  })
})

describe('translate', () => {
  it('returns the string for the requested locale', () => {
    expect(translate('en', 'nav.settings')).toBe('Settings')
    expect(translate('he', 'nav.settings')).toBe('הגדרות')
  })

  it('interpolates {name} params', () => {
    expect(translate('en', 'scan.errors', { count: 3 })).toBe('3 errors')
    expect(translate('he', 'table.exported', { count: 2, path: '/tmp/x.csv' })).toBe(
      'יוצאו 2 שורות אל /tmp/x.csv'
    )
  })

  it('leaves an unmatched placeholder intact rather than printing undefined', () => {
    expect(translate('en', 'table.noMatch', {})).toBe('No invoices match “{query}”.')
  })
})

describe('catalogue integrity', () => {
  it('has identical key sets for every locale (no missing translations)', () => {
    const en = Object.keys(messages.en).sort()
    const he = Object.keys(messages.he).sort()
    expect(he).toEqual(en)
  })

  it('offers Hebrew first, then English', () => {
    expect(LOCALE_OPTIONS.map((o) => o.value)).toEqual(['he', 'en'])
    for (const o of LOCALE_OPTIONS) expect(o.label).toBeTruthy()
  })
})
