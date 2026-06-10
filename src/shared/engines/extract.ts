/**
 * RONY — Deterministic field extraction (vendor + total amount).
 *
 * Pure, framework-agnostic logic: given the PLAIN TEXT of an invoice/receipt
 * (extracted from a PDF text-layer upstream, via unpdf) it pulls out the
 * Supplier/Vendor name and the grand-total amount using Regex. Lives in
 * `src/shared/` alongside the classifier so it stays Node/Electron-free and
 * fully unit-testable.
 *
 * REALITY THIS IS BUILT FOR: a PDF text-layer extracted by unpdf is essentially
 * ONE long line — items are joined by spaces, not newlines, the reading order of
 * Hebrew (RTL) documents is often scrambled, and stray NUL () bytes appear
 * where some glyphs were. So we do NOT rely on line structure. Instead:
 *
 *  - AMOUNT: we only accept a number that sits NEXT TO a recognised total-label
 *    (Hebrew or English) AND is "money-shaped" (carries a separator/decimal or a
 *    currency symbol, or is short). Requiring a nearby total-label is what keeps
 *    us from grabbing a VAT/registration number, a UID, an invoice number, or a
 *    line-item — the bugs a "largest number" heuristic produced on real files.
 *    When no labelled total is found we return `null` (the row is flagged), never
 *    a guess.
 *  - VENDOR: the issuing business is found from a company-form suffix
 *    ("… בע״מ" / "… Ltd" / "… PBC"), skipping the one that follows a "Bill to" /
 *    "לכבוד" marker (that is the CUSTOMER), and `null` when none is convincing.
 *
 * ⚠️ Keep this file free of Node / Electron / Vue imports — it must run anywhere.
 */

/** The fields this engine extracts from an invoice's text. */
export interface ExtractedInvoiceFields {
  /** Supplier/vendor business name, or null when not confidently found. */
  vendor: string | null
  /** Grand-total amount as a plain number, or null when not confidently found. */
  amount: number | null
  /** ISO-4217 currency code (e.g. "ILS","USD"), or null. */
  currency: string | null
}

/* ------------------------------------------------------------------ *
 * Currency detection.
 * ------------------------------------------------------------------ */

/** [pattern, ISO-4217 code] — first match in a snippet wins. */
const CURRENCY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/₪|ש["״׳']?\s?ח|שקל\w*|\bNIS\b|\bILS\b/iu, 'ILS'],
  [/\$|\bUSD\b|dollars?|דולר/iu, 'USD'],
  [/€|\bEUR\b|euros?|יורו|אירו/iu, 'EUR'],
  [/£|\bGBP\b|pounds?/iu, 'GBP']
]

/** First currency mentioned in `text`, or null if none recognised. */
export function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_PATTERNS) {
    if (pattern.test(text)) return code
  }
  return null
}

/** Currency symbols (used for the money-shape adjacency test). */
const CURRENCY_SYMBOL = /[₪$€£]/

/* ------------------------------------------------------------------ *
 * Amount parsing.
 *
 * Invoices mix two separator conventions:
 *   - "1,234.56" (comma thousands, dot decimal)   — common in IL/US
 *   - "1.234,56" (dot thousands, comma decimal)   — common in the EU
 * We normalise both into a JS float.
 * ------------------------------------------------------------------ */

/**
 * Parse a single money token (e.g. "1,234.50", "1.234,50") into a number, or
 * null if it isn't a plausible amount. Currency symbols must already be stripped
 * by the caller — this only sees the numeric run.
 */
export function parseAmount(raw: string): number | null {
  const token = raw.replace(/\s/g, '')
  if (!/\d/.test(token)) return null

  const lastComma = token.lastIndexOf(',')
  const lastDot = token.lastIndexOf('.')

  let normalised: string
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the RIGHTMOST one is the decimal point; the other groups.
    const decimalSep = lastComma > lastDot ? ',' : '.'
    const groupSep = decimalSep === ',' ? '.' : ','
    normalised = token.split(groupSep).join('').replace(decimalSep, '.')
  } else if (lastComma !== -1 || lastDot !== -1) {
    // Only one kind of separator: decide decimal vs. thousands by shape.
    const sep = lastComma !== -1 ? ',' : '.'
    const parts = token.split(sep)
    const tail = parts[parts.length - 1]
    // "1,234" / "1.234" (single sep, exactly 3 trailing digits) → thousands.
    // "1,234,567" (multiple seps) → thousands. Otherwise (e.g. "100,50",
    // "1234.5") → decimal.
    const isThousands = parts.length > 2 || (parts.length === 2 && tail.length === 3)
    normalised = isThousands ? parts.join('') : `${parts.slice(0, -1).join('')}.${tail}`
  } else {
    normalised = token
  }

  const value = Number(normalised)
  return Number.isFinite(value) ? value : null
}

/* ------------------------------------------------------------------ *
 * Total-amount extraction (label-anchored, on linear text).
 * ------------------------------------------------------------------ */

/**
 * STRONG total labels (tier 2): an explicit "amount the customer must pay".
 * These beat a bare "total" when both are present. Matched globally so we get
 * every occurrence and its position. Hebrew quote variants (" ׳ ״) are optional.
 */
const STRONG_LABEL =
  /amount\s*(?:due|payable|paid)|(?:total|balance)\s*(?:due|payable)|grand\s*total|לתשלום/giu

/** MEDIUM total labels (tier 1): a "total"/"sum", absent a stronger payable label. */
const MEDIUM_LABEL = /total|סה["״׳']?\s?כ|סך\s*הכ(?:ל|ול)|סכום/giu

/**
 * A money-shaped numeric token. The first alternative is thousands-grouped
 * ("1,234.56" / "22,200") and REQUIRES at least one group (`+`, not `*`) so it
 * never captures just the first 3 digits of a plain number; the second handles
 * plain integers and simple decimals ("2026", "48.60", "5.00").
 */
const NUMBER_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g

/** How many characters around a total-label we look in for its amount. */
const LABEL_WINDOW = 25

interface Label {
  index: number
  end: number
  /** 2 = strong (payable), 1 = medium (total/sum). */
  tier: number
}

/** All total-labels in the text; subtotals dropped. */
function findLabels(text: string): Label[] {
  const labels: Label[] = []

  for (const m of text.matchAll(STRONG_LABEL)) {
    labels.push({ index: m.index, end: m.index + m[0].length, tier: 2 })
  }
  for (const m of text.matchAll(MEDIUM_LABEL)) {
    const before = text.slice(Math.max(0, m.index - 4), m.index).toLowerCase()
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 7)
    // "subtotal" / "סכום ביניים" are NOT the grand total — never anchor on them.
    if (/sub[\s-]?$/.test(before)) continue
    if (/^\s*ביניים/u.test(after)) continue
    labels.push({ index: m.index, end: m.index + m[0].length, tier: 1 })
  }
  return labels
}

interface NumberToken {
  index: number
  end: number
  raw: string
  value: number
}

/** Money-shaped numeric tokens (separator/decimal, currency-adjacent, or short). */
function findNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = []
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0]
    const value = parseAmount(raw)
    if (value === null || value <= 0 || value >= 1e8) continue

    const hasSeparator = /[.,]/.test(raw)
    const around = text.slice(Math.max(0, m.index - 2), m.index + raw.length + 2)
    const currencyAdjacent = CURRENCY_SYMBOL.test(around)
    const digits = raw.replace(/[.,]/g, '').length
    // A bare integer of 5+ digits with no separator is an ID (invoice/VAT/UID),
    // not a total — reject unless a currency symbol sits right beside it.
    if (!hasSeparator && !currencyAdjacent && digits >= 5) continue

    // Skip date fragments: a number touching a date separator (2026-04-07,
    // 16/04/2026) or a bare 4-digit year. Generated email-body PDFs often leave
    // the "סכום" field empty, and the nearest number is the message date.
    const prev = text[m.index - 1]
    const next = text[m.index + raw.length]
    const dateAdjacent = prev === '-' || prev === '/' || next === '-' || next === '/'
    const yearLike = !hasSeparator && /^\d{4}$/.test(raw) && value >= 1900 && value <= 2100
    if (dateAdjacent || yearLike) continue

    tokens.push({ index: m.index, end: m.index + raw.length, raw, value })
  }
  return tokens
}

/**
 * The amount that belongs to one label: the nearest number AFTER it (a value
 * follows its label — "Total 500", "סה״כ 1,990"), else the nearest number
 * BEFORE it (RTL extraction sometimes flips them — "1,990 סה״כ"). This directional
 * rule is what separates "Total 500 / Amount Due 450" correctly, and stops a
 * VAT figure ("מע״מ 18 / סה״כ 118") from being read as the total.
 */
function amountForLabel(label: Label, numbers: NumberToken[]): NumberToken | null {
  let after: NumberToken | null = null
  let before: NumberToken | null = null
  for (const num of numbers) {
    if (num.index >= label.end) {
      const g = num.index - label.end
      if (g <= LABEL_WINDOW && (after === null || g < after.index - label.end)) after = num
    } else if (num.end <= label.index) {
      const g = label.index - num.end
      if (g <= LABEL_WINDOW && (before === null || g < label.index - before.end)) before = num
    }
  }
  return after ?? before
}

/**
 * Find the grand total: for each total-label take its amount (above), then pick
 * the strongest label, breaking ties by proximity then by the larger figure.
 * Returns null when no number lands within {@link LABEL_WINDOW} of any label.
 */
function extractAmount(text: string): { amount: number | null; currency: string | null } {
  const labels = findLabels(text)
  const numbers = findNumbers(text)
  if (labels.length === 0 || numbers.length === 0) return { amount: null, currency: null }

  let best: { tier: number; value: number; distance: number; at: number } | null = null
  for (const label of labels) {
    const num = amountForLabel(label, numbers)
    if (num === null) continue
    const distance = num.index >= label.end ? num.index - label.end : label.index - num.end
    const better =
      best === null ||
      label.tier > best.tier ||
      (label.tier === best.tier &&
        (distance < best.distance || (distance === best.distance && num.value > best.value)))
    if (better) best = { tier: label.tier, value: num.value, distance, at: num.index }
  }

  if (best === null) return { amount: null, currency: null }
  // Currency from the chosen number's immediate neighbourhood, else whole-doc.
  const near = text.slice(Math.max(0, best.at - 10), best.at + 12)
  return { amount: best.value, currency: detectCurrency(near) ?? detectCurrency(text) }
}

/* ------------------------------------------------------------------ *
 * Vendor extraction (on linear text).
 *
 * The issuing business almost always carries a company-form suffix. We take the
 * words right before it — but skip the company that directly follows a "Bill to"
 * / "לכבוד" marker, which is the CUSTOMER, not the supplier.
 * ------------------------------------------------------------------ */

/** Company-form suffixes — a strong "this is the business" signal. */
const COMPANY_SUFFIX =
  /בע["״׳']?מ|\bLtd\b|\bLimited\b|\bLLC\b|\bInc\b|\bPBC\b|\bCorp\b|\bGmbH\b|\bL\.L\.C\b/giu

/** "Addressed-to" markers — the name after these is the customer, skip it. */
const ADDRESSED_TO = /bill\s*to|ship\s*to|sold\s*to|לכבוד|לקוח|מאת/iu

/** Leading words that are document boilerplate, not part of a business name. */
const LEADING_NOISE =
  /^(?:total|subtotal|sub|in|due|amount|balance|grand|vat|of|the|to|paid|payable|for|invoice|tax|receipt|eur|usd|ils|nis|gbp)\b[\s.:,–—-]*/i

/** Trim, collapse whitespace, strip wrapping punctuation + boilerplate, cap length. */
function cleanVendor(raw: string): string {
  let name = raw
    .replace(/\s+/g, ' ')
    // Strip any leading non-alphanumerics (") ", "% ", "* ", quotes) and any
    // trailing punctuation — keeps the company suffix (ends in a letter) intact.
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[\s"'`*•|%:,.\-–—]+$/u, '')
    .trim()
  // Strip a leading Hebrew "addressed-to" word the fallback pass may include
  // ("לכבוד אלי … בע״מ" → "אלי … בע״מ").
  name = name.replace(/^(?:לכבוד|מאת|לקוח|עבור)\s+/u, '')
  // Strip leading boilerplate words ("Total in EUR Google …" → "Google …").
  while (LEADING_NOISE.test(name)) name = name.replace(LEADING_NOISE, '')
  return name.trim().slice(0, 80)
}

/**
 * Take the business name immediately before a company suffix. We cut at the last
 * "field boundary" — a digit, certain punctuation, a sentence period, or a run
 * of spaces — so we don't drag in the previous sentence, an address, or a label.
 * Parentheses and commas are kept (they appear inside names: "Anthropic, PBC",
 * "(E.B)").
 */
const FIELD_BOUNDARY = /[\d:|*•%!?\t]|\.\s|\s{2,}/g

function nameBeforeSuffix(text: string, suffixStart: number): string {
  const chunk = text.slice(Math.max(0, suffixStart - 40), suffixStart)
  let lastEnd = 0
  for (const mm of chunk.matchAll(FIELD_BOUNDARY)) lastEnd = mm.index + mm[0].length
  return chunk.slice(lastEnd)
}

/** Extract the vendor name, or null when no convincing candidate exists. */
function extractVendor(text: string): string | null {
  const matches = [...text.matchAll(COMPANY_SUFFIX)]
  // First pass: a company NOT preceded by an "addressed-to" marker (the seller).
  for (const m of matches) {
    const lead = text.slice(Math.max(0, m.index - 30), m.index)
    if (ADDRESSED_TO.test(lead)) continue
    const name = cleanVendor(nameBeforeSuffix(text, m.index) + m[0])
    if (name.length > m[0].length && /\p{L}/u.test(name)) return name
  }
  // Fallback: the first company-suffix match even if it followed a marker, so a
  // single-party document (only the issuer named) still yields a vendor.
  for (const m of matches) {
    const name = cleanVendor(nameBeforeSuffix(text, m.index) + m[0])
    if (name.length > m[0].length && /\p{L}/u.test(name)) return name
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Public entry point.
 * ------------------------------------------------------------------ */

/**
 * Extract the supplier/vendor name and grand-total amount from an invoice's
 * plain text. Any field we cannot determine confidently is returned as `null`
 * (the caller leaves it empty so the row is visibly flagged for review).
 */
export function extractInvoiceFields(text: string): ExtractedInvoiceFields {
  if (!text || !text.trim()) return { vendor: null, amount: null, currency: null }

  // Stray NUL bytes appear in unpdf output where some glyphs were — treat as space.
  const clean = text.split(String.fromCharCode(0)).join(' ')

  const { amount, currency } = extractAmount(clean)
  return { vendor: extractVendor(clean), amount, currency }
}
