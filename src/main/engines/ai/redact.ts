/**
 * RONY-10 (privacy) — PII redaction for the AI engine.
 *
 * DATA FLOW: the AI engine sends the email's Subject + body text to a third-party
 * provider (OpenAI/Gemini). Before that text leaves the machine we mask the
 * high-confidence personal identifiers below, so an account/card number or phone
 * is never transmitted. This is a chokepoint called from `buildUserPrompt`, so
 * EVERY provider and tier (fast text + strong vision) gets the redacted text.
 *
 * WHAT WE MASK: email addresses, phone numbers, IBAN/account/card numbers, and
 * national-ID (ת"ז) numbers.
 *
 * WHAT WE DELIBERATELY KEEP — and why:
 *  - The `From` sender is NOT redacted here (it is rendered separately): the AI
 *    derives the VENDOR from it, so masking it would break extraction. Its
 *    disclosure is covered by the explicit consent dialog instead.
 *  - Monetary AMOUNTS and DATES are preserved — they are the whole point of the
 *    scan. Every pattern below is shaped so it cannot match a total (amounts use
 *    separators and are short) or an ISO/`dd/mm` date (broken by dashes/slashes).
 *
 * LIMITATION: free-form personal names and street addresses are NOT reliably
 * detectable with regex without harming vendor/amount extraction, so they are
 * intentionally out of scope here and are covered by the consent disclosure.
 * The redaction is defense-in-depth for the highest-risk identifiers, not a
 * guarantee of full anonymization.
 *
 * Pure + dependency-free, so it is fully unit-tested (see redact.test.ts).
 */

/**
 * Ordered list of [pattern, replacement]. Order matters: the LABELLED account /
 * ID rules run before the phone and generic-number rules so a labelled value is
 * tagged precisely rather than swallowed by a broader rule.
 */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Email addresses.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
  // IBAN: 2 country letters + 2 check digits + 11–30 alphanumerics (spaced or not).
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, '[ACCOUNT]'],
  // Account number when labelled — Hebrew ע"ח / חשבון, English account/acct.
  [/((?:ע["״׳']?ח|חשבון|account|acct)[\s:#.-]*)\d[\d\s-]{3,}\d/gi, '$1[ACCOUNT]'],
  // National ID when labelled — Hebrew ת"ז / ת.ז / תעודת זהות.
  [/((?:ת["״׳'.]?ז["״׳'.]?|תעודת\s?זהות)[\s:#-]*)\d{5,9}/g, '$1[ID]'],
  // Phone — +972 international, or Israeli leading-0 (7–8 subscriber digits).
  [/\+972[-\s]?\d[\d\s-]{6,11}/g, '[PHONE]'],
  [/\b0\d{1,2}[-\s]?\d{6,8}\b/g, '[PHONE]'],
  // Grouped card number (4-4-4-1..4).
  [/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{1,4}\b/g, '[CARD]'],
  // Any other bare run of 9+ digits — an account/ID/long number. Totals use
  // separators and are far shorter, so this never masks an amount.
  [/\b\d{9,}\b/g, '[NUMBER]']
]

/**
 * Mask high-confidence PII in free text before it is sent to an AI provider.
 * Returns the text with identifiers replaced by `[EMAIL]`, `[PHONE]`,
 * `[ACCOUNT]`, `[CARD]`, `[ID]`, or `[NUMBER]`. Empty/whitespace input is
 * returned unchanged.
 */
export function redactPii(text: string): string {
  if (!text) return text
  return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}
