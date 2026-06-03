import { describe, it, expect } from 'vitest'
import {
  engineLabel,
  formatAmount,
  formatDate,
  sortInvoices,
  filterInvoices,
  invoicesToCsv,
  type SortKey
} from './invoiceTable'
import type { Invoice } from '@shared/types'

/** Build an Invoice with sensible defaults; override only what a test cares about. */
function inv(over: Partial<Invoice>): Invoice {
  return {
    id: 1,
    messageId: null,
    date: '2026-01-01',
    dateSource: 'email',
    vendor: 'Acme',
    amount: 100,
    currency: 'ILS',
    localFilePath: null,
    status: 'pending',
    engineType: 'deterministic',
    createdAt: '2026-01-01T00:00:00Z',
    ...over
  }
}

describe('engineLabel', () => {
  it('maps engine types to readable labels', () => {
    expect(engineLabel('deterministic')).toBe('Deterministic')
    expect(engineLabel('ai')).toBe('AI')
  })
})

describe('formatAmount', () => {
  it('formats amount with the currency symbol', () => {
    expect(formatAmount(1234.5, 'ILS')).toBe('₪1,234.50')
    expect(formatAmount(100, 'USD')).toBe('$100.00')
  })
  it('falls back to the code for a malformed currency', () => {
    expect(formatAmount(50, 'US')).toBe('50.00 US')
  })
  it('omits currency when null and shows dash for null amount', () => {
    expect(formatAmount(99, null)).toBe('99.00')
    expect(formatAmount(null, 'USD')).toBe('—')
  })
})

describe('formatDate', () => {
  it('formats an ISO date as DD/MM/YYYY and dashes a missing one', () => {
    expect(formatDate('2026-05-20')).toBe('20/05/2026')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })
})

describe('sortInvoices', () => {
  it('sorts by amount ascending and descending without mutating input', () => {
    const list = [
      inv({ id: 1, amount: 30 }),
      inv({ id: 2, amount: 10 }),
      inv({ id: 3, amount: 20 })
    ]
    const asc = sortInvoices(list, 'amount', 'asc').map((i) => i.id)
    expect(asc).toEqual([2, 3, 1])
    expect(sortInvoices(list, 'amount', 'desc').map((i) => i.id)).toEqual([1, 3, 2])
    expect(list.map((i) => i.id)).toEqual([1, 2, 3]) // original untouched
  })

  it('sorts vendor strings alphabetically', () => {
    const list = [inv({ id: 1, vendor: 'Zeta' }), inv({ id: 2, vendor: 'alpha' })]
    expect(sortInvoices(list, 'vendor', 'asc').map((i) => i.id)).toEqual([2, 1])
  })

  it.each<SortKey>(['amount', 'vendor', 'date'])(
    'always sinks null/empty %s values to the bottom, even descending',
    (key) => {
      const list = [
        inv({ id: 1, amount: null, vendor: null, date: null }),
        inv({ id: 2, amount: 50, vendor: 'B', date: '2026-02-02' })
      ]
      expect(sortInvoices(list, key, 'desc').map((i) => i.id)).toEqual([2, 1])
      expect(sortInvoices(list, key, 'asc').map((i) => i.id)).toEqual([2, 1])
    }
  )
})

describe('filterInvoices', () => {
  const list = [
    inv({ id: 1, vendor: 'Electric Co', engineType: 'ai', amount: 540 }),
    inv({ id: 2, vendor: 'Water Ltd', engineType: 'deterministic', amount: 12 })
  ]

  it('returns everything for a blank query', () => {
    expect(filterInvoices(list, '   ')).toHaveLength(2)
  })
  it('matches vendor case-insensitively', () => {
    expect(filterInvoices(list, 'electric').map((i) => i.id)).toEqual([1])
  })
  it('matches the engine label and the raw amount', () => {
    expect(filterInvoices(list, 'AI').map((i) => i.id)).toEqual([1])
    expect(filterInvoices(list, '12').map((i) => i.id)).toEqual([2])
  })
})

describe('invoicesToCsv', () => {
  it('emits a header and one CRLF-separated row per invoice with machine-friendly values', () => {
    const csv = invoicesToCsv([
      inv({ date: '2026-05-01', vendor: 'Acme', amount: 1234.5, currency: 'ILS', engineType: 'ai' })
    ])
    const [header, row] = csv.split('\r\n')
    expect(header).toBe('Date,Vendor,Amount,Currency,Found by,Status,File')
    // Raw numeric amount (no thousands separators), AI label.
    expect(row).toBe('2026-05-01,Acme,1234.5,ILS,AI,pending,')
  })

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    const csv = invoicesToCsv([inv({ vendor: 'Smith, "Bob" & Co\nLtd' })])
    expect(csv.split('\r\n')[1]).toContain('"Smith, ""Bob"" & Co\nLtd"')
  })

  it('renders null fields as empty cells and preserves Hebrew', () => {
    const csv = invoicesToCsv([
      inv({ date: null, vendor: 'חשבונית בע״מ', amount: null, currency: null })
    ])
    const row = csv.split('\r\n')[1]
    expect(row.startsWith(',חשבונית בע״מ,,,')).toBe(true)
  })

  it('returns just the header for an empty list', () => {
    expect(invoicesToCsv([])).toBe('Date,Vendor,Amount,Currency,Found by,Status,File')
  })
})
