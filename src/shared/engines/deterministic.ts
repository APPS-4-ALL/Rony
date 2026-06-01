/**
 * RONY-9 — Deterministic (local) scan engine.
 *
 * Pure, framework-agnostic logic: given the textual parts of an email it
 * decides whether the message looks like an invoice/receipt, using keyword
 * and Regex matching. Lives in `src/shared/` so BOTH the main process (real
 * scanning, RONY-11) and the renderer (previewing/testing) can import it
 * without pulling in Electron or Node APIs.
 *
 * ⚠️ Keep this file free of Node / Electron / Vue imports — it must run anywhere.
 */

/** The textual inputs the engine inspects. */
export interface DeterministicInput {
  subject: string
  body: string
  /** Attachment file names, e.g. ["invoice_2026.pdf"]. */
  filenames: string[]
}

/** The engine's verdict for one email. */
export interface DeterministicResult {
  isInvoice: boolean
  /** Keywords/patterns that fired — surfaced in the UI for transparency. */
  matchedKeywords: string[]
}

/**
 * Keyword seeds (English + Hebrew). RONY-9 owner: expand these and/or turn
 * them into tuned Regex patterns. Kept as an exported constant so they are
 * easy to unit-test independently.
 */
export const INVOICE_KEYWORDS: readonly string[] = [
  'invoice',
  'receipt',
  'tax invoice',
  'חשבונית',
  'קבלה',
  'חשבונית מס'
]

/**
 * Decide whether an email is an invoice/receipt.
 *
 * TODO(RONY-9): implement the real matching:
 *   - normalise / lower-case the text,
 *   - run keyword + Regex matching over subject, body, and each filename,
 *   - collect every distinct match into `matchedKeywords`,
 *   - return isInvoice = matchedKeywords.length > 0 (or your tuned threshold).
 *
 * DoD: running this on a fixed string finds a match by the predefined keywords.
 */
export function classifyDeterministic(input: DeterministicInput): DeterministicResult {
  void input
  // Placeholder so the Step-0 contract compiles until RONY-9 fills it in.
  return { isInvoice: false, matchedKeywords: [] }
}
