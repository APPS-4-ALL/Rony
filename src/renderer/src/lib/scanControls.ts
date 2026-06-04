/**
 * Scan-control helpers (pure, framework-free). Hebrew-only.
 */
import type { ScanProgress } from '@shared/types'

/** A human label for the current scan progress, e.g. "סורק 12 מתוך 50…". */
export function progressLabel(p: ScanProgress): string {
  switch (p.phase) {
    case 'fetching':
      return 'מאחזר הודעות…'
    case 'classifying':
      return `סורק ${p.processed} מתוך ${p.total}…`
    case 'downloading':
      return `מוריד ${p.processed} מתוך ${p.total} ${p.total === 1 ? 'קובץ' : 'קבצים'}…`
    case 'done':
      return 'מסיים…'
  }
}

/** Quick caps for how many messages to scan (the main process clamps to 1000). */
export const COUNT_OPTIONS = [50, 100, 250, 500, 1000] as const

/** A selectable scan key for the date range. `custom` reveals the From/To pickers. */
export type RangeKey = 'week' | 'month' | 'quarter' | 'year' | 'custom'

/**
 * Quick date-range presets, in display order. `days` is the look-back window;
 * `custom` (days = null) lets the user pick explicit From/To dates.
 */
export const RANGE_PRESETS: ReadonlyArray<{ key: RangeKey; label: string; days: number | null }> = [
  { key: 'week', label: 'שבוע אחרון', days: 7 },
  { key: 'month', label: 'חודש אחרון', days: 30 },
  { key: 'quarter', label: '3 חודשים', days: 90 },
  { key: 'year', label: 'שנה אחרונה', days: 365 },
  { key: 'custom', label: 'טווח מותאם', days: null }
]

/** The ISO date (YYYY-MM-DD) `days` before `from` (default: today). */
export function isoDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Look-back window (in days) for a preset key, or null for `custom`/unknown. */
export function rangeDays(key: RangeKey): number | null {
  return RANGE_PRESETS.find((p) => p.key === key)?.days ?? null
}
