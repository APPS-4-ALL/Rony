/**
 * Scan-option sanitisation (pure, no Electron/network imports).
 *
 * The renderer is untrusted, so the per-run scan controls that arrive over IPC
 * are validated here before they reach the Gmail query builder: a bad count or
 * a malformed date is dropped rather than trusted, falling back to the engine
 * defaults (50 messages, last 1 year). Kept pure so it can be unit-tested.
 */
import type { ScanOptions } from '../../shared/types'

/** Upper bound on a single run, so a runaway value can't fetch the whole mailbox. */
export const MAX_ALLOWED_RESULTS = 1000

/** Gmail's date operators take YYYY-MM-DD here (converted to YYYY/MM/DD downstream). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Coerce an untrusted IPC payload into a safe `ScanOptions`. Invalid or missing
 * fields are simply omitted (so `fetchEmails` applies its defaults):
 *  - `maxResults` → a whole number clamped to [1, MAX_ALLOWED_RESULTS].
 *  - `after` / `before` → kept only when they are ISO `YYYY-MM-DD` strings.
 */
export function sanitizeScanOptions(raw: unknown): ScanOptions {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: ScanOptions = {}

  if (typeof o.maxResults === 'number' && Number.isFinite(o.maxResults)) {
    const n = Math.floor(o.maxResults)
    if (n >= 1) out.maxResults = Math.min(n, MAX_ALLOWED_RESULTS)
  }
  if (typeof o.after === 'string' && ISO_DATE.test(o.after)) out.after = o.after
  if (typeof o.before === 'string' && ISO_DATE.test(o.before)) out.before = o.before

  return out
}
