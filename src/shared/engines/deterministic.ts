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

/* ------------------------------------------------------------------ *
 * Keyword list (English + Hebrew).
 *
 * Grouped by language for readability, then flattened into the exported
 * `INVOICE_KEYWORDS` constant. To extend the engine, just add a term to the
 * relevant group below — no other code changes needed; each term is compiled
 * into a case-insensitive Regex automatically.
 *
 * Keep terms lower-case and trimmed. Multi-word terms (e.g. "tax invoice")
 * match across any run of whitespace, so "tax   invoice" still matches.
 * ------------------------------------------------------------------ */

const ENGLISH_KEYWORDS = [
  'invoice',
  'tax invoice',
  'receipt',
  'bill',
  'payment receipt',
  'sales receipt',
  'purchase invoice',
  'order confirmation'
] as const

const HEBREW_KEYWORDS = [
  'חשבונית', // invoice
  'חשבונית מס', // tax invoice
  'חשבון עסקה', // transaction/proforma invoice
  'קבלה', // receipt
  'אישור תשלום', // payment confirmation
  'דרישת תשלום' // payment demand
] as const

/** Flat, de-duplicated keyword list the engine matches against. */
export const INVOICE_KEYWORDS: readonly string[] = [
  ...new Set<string>([...ENGLISH_KEYWORDS, ...HEBREW_KEYWORDS])
]

/** True if the term contains Latin letters (so we treat it as an English term). */
function hasLatinLetters(term: string): boolean {
  return /[a-z]/i.test(term)
}

/**
 * Compile one keyword into a matcher Regex:
 *  - escape any Regex metacharacters in the term,
 *  - allow any whitespace run between words ("tax invoice" → /tax\s+invoice/),
 *  - flags: `i` (case-insensitive, for Latin) + `u` (Unicode, for Hebrew).
 *
 * Boundary handling differs by language ON PURPOSE:
 *  - English terms are wrapped in Unicode-aware "letter boundaries"
 *    `(?<=\P{L}|^) … (?=\P{L}|$)` so short words don't match inside longer
 *    ones — e.g. "bill" no longer fires on "billing"/"billion"/"Bill Gates".
 *    (We avoid `\b`, which is ASCII-only and misbehaves around Hebrew.)
 *  - Hebrew terms are matched as substrings (no boundary), because Hebrew
 *    glues prefixes onto nouns — "החשבונית" (the invoice), "וקבלה" (and a
 *    receipt) — and a boundary would make those legitimate forms miss.
 */
function compileKeyword(keyword: string): RegExp {
  const escaped = keyword
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
  const pattern = hasLatinLetters(keyword) ? `(?<=\\P{L}|^)${escaped}(?=\\P{L}|$)` : escaped
  return new RegExp(pattern, 'iu')
}

/** Pre-compiled (keyword, pattern) pairs — built once at module load. */
const KEYWORD_PATTERNS: ReadonlyArray<{ keyword: string; pattern: RegExp }> = INVOICE_KEYWORDS.map(
  (keyword) => ({ keyword, pattern: compileKeyword(keyword) })
)

/**
 * Decide whether an email is an invoice/receipt by matching the predefined
 * keywords (as Regex) against the subject, body, and every attachment filename.
 *
 * DoD: running this on a fixed string finds a match by the predefined keywords.
 */
export function classifyDeterministic(input: DeterministicInput): DeterministicResult {
  // `body` is already clean plain text here: the RONY-7 parser strips HTML and
  // decodes the base64 parts before handing the email to any engine, so we can
  // build the haystack directly without re-sanitising.
  const haystack = [input.subject, input.body, ...input.filenames]
    .filter((part): part is string => Boolean(part))
    .join('\n')

  const matchedKeywords = KEYWORD_PATTERNS.filter(({ pattern }) => pattern.test(haystack)).map(
    ({ keyword }) => keyword
  )

  return { isInvoice: matchedKeywords.length > 0, matchedKeywords }
}
