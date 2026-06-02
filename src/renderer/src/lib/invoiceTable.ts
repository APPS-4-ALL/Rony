/**
 * RONY-13 — Dashboard table logic (pure, framework-free).
 *
 * Formatting, sorting, and filtering for the invoices DataTable live here, away
 * from the Vue component, so they can be unit-tested without a DOM. The
 * component is then a thin view over these functions.
 */
import type { EngineType, Invoice } from '@shared/types'

/** Columns the table can sort by. */
export type SortKey = 'date' | 'vendor' | 'amount' | 'engineType' | 'status'
export type SortDir = 'asc' | 'desc'

/** Human label for the scan engine that catalogued an invoice. */
export function engineLabel(engine: EngineType): string {
  return engine === 'ai' ? 'AI' : 'Deterministic'
}

/** Format an amount + currency for display, e.g. `1,234.50 ILS`, or `—`. */
export function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return '—'
  const num = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
  return currency ? `${num} ${currency}` : num
}

/** Show an ISO date as-is (already `YYYY-MM-DD`), or `—` when unknown. */
export function formatDate(date: string | null): string {
  return date && date.trim() ? date : '—'
}

/**
 * Compare two invoices by `key`. Missing values (null/empty) always sort to the
 * BOTTOM regardless of direction, so blank rows never crowd out real data.
 */
export function compareInvoices(a: Invoice, b: Invoice, key: SortKey, dir: SortDir): number {
  const av = a[key]
  const bv = b[key]

  const aEmpty = av == null || av === ''
  const bEmpty = bv == null || bv === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  let cmp: number
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
  else cmp = String(av).localeCompare(String(bv))

  return dir === 'asc' ? cmp : -cmp
}

/** Return a new array sorted by `key`/`dir` (does not mutate the input). */
export function sortInvoices(invoices: Invoice[], key: SortKey, dir: SortDir): Invoice[] {
  return [...invoices].sort((a, b) => compareInvoices(a, b, key, dir))
}

/**
 * Case-insensitive substring filter across the visible fields (vendor, date,
 * currency, engine, status, and the raw amount). Blank query → everything.
 */
export function filterInvoices(invoices: Invoice[], query: string): Invoice[] {
  const q = query.trim().toLowerCase()
  if (!q) return invoices
  return invoices.filter((inv) => {
    const haystack = [
      inv.vendor,
      inv.date,
      inv.currency,
      engineLabel(inv.engineType),
      inv.status,
      inv.amount != null ? String(inv.amount) : ''
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}
