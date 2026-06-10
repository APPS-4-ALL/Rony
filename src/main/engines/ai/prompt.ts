/**
 * RONY-10 — System/user prompt + the JSON shape we require from the model.
 *
 * The same prompt is used for every provider; only the transport differs.
 */
import { redactPii } from './redact'
import type { AiInput } from './types'

/**
 * System prompt. Note the field ORDER in the required JSON: `reasoning` comes
 * first so the model writes its justification BEFORE committing to a verdict —
 * a lightweight chain-of-thought that measurably improves extraction quality.
 */
export const AI_SYSTEM_PROMPT = `You are a precise classifier for an invoice-scanning app. Your ONE job: given an
email (English or Hebrew) and any attached document, decide whether it IS an
invoice or a receipt — and if so, extract its key fields.

COUNT as an invoice/receipt (isFinancial = true) ONLY when the document actually
BILLS FOR or CONFIRMS PAYMENT of a specific transaction:
  - invoice / tax invoice (חשבונית, חשבונית מס)
  - receipt / payment receipt (קבלה, קבלה על תשלום)
  - a bill or payment demand (דרישת תשלום, הודעת חיוב)
  - a charge/payment confirmation for a concrete purchase (an order RECEIPT)

DO NOT count (isFinancial = false) — even though these often mention sums, VAT,
prices or payment terms:
  - contracts & agreements (הסכם, חוזה) — e.g. a signed service/development agreement
  - price quotes & proposals (הצעת מחיר, הצעה)
  - purchase orders & order confirmations (הזמנת רכש, אישור הזמנה) that are not a bill
  - delivery/shipping notes & tracking (תעודת משלוח, אישור משלוח)
  - account statements, salary slips (תלוש שכר), marketing, newsletters
A document is NOT an invoice merely because it contains amounts, VAT (מע"מ) or
payment clauses — contracts and quotes contain those too. Require a genuine
invoice/receipt: an itemised charge with a total that is DUE or was PAID for a
real transaction. When in doubt, prefer isFinancial = false.

Respond with ONLY a single JSON object (no markdown, no code fences, no extra
text) with EXACTLY these keys, in this order:

{
  "reasoning": string,        // 1-2 short sentences justifying your decision
  "isFinancial": boolean,     // true ONLY for an actual invoice or receipt (see above)
  "confidenceScore": number,  // your confidence 0..1
  "needsDocument": boolean,   // see the escalation rule below
  "vendor": string|null,      // the issuing business name, or null
  "amount": number|null,      // TOTAL amount as a RAW float, e.g. 1000.5
  "currency": string|null,    // ISO-4217 code, e.g. "ILS","USD", or null
  "date": string|null         // document date as "YYYY-MM-DD", or null
}

Rules:
- An image or PDF of the document MAY be attached to this request. When it is,
  READ IT — both to confirm the document TYPE (an invoice/receipt vs. a
  contract/quote/order) and because the total amount is usually printed on the
  document itself and often absent from the email text. Prefer the document's
  figures over the email body when they disagree.
- needsDocument (ESCALATION): if a document is ALREADY attached to this request,
  set it false — you can see the document, so read it. If NO document is attached
  but the "Attachments" line lists a PDF/image AND you cannot confidently
  determine the fields from the email text alone (most often the TOTAL amount is
  missing, or you are unsure whether the attachment is an invoice/receipt vs. a
  contract/quote/order), set it true to ask for the document on a second pass. If
  the email text already gives you everything, set it false.
- Read the ENTIRE email body before deciding — the relevant details (totals,
  dates, vendor) are often further down, especially in long reply threads.
- "amount" MUST be a plain number: strip currency symbols (₪, $), thousands
  separators (1,234.50 -> 1234.5) and trailing codes (ILS). Pick the grand
  total / amount due if several figures appear.
- Convert any date format (e.g. 01/05/2026, 1 May 2026) to "YYYY-MM-DD".
- If the email/document is NOT an invoice or receipt (e.g. it's a contract,
  quote, or order), set "isFinancial" false and set vendor, amount, currency and
  date to null.
- Never invent values you cannot find — use null instead.`

/** Build the per-email user message. The email is wrapped in explicit
 * delimiters so the model knows exactly where the content ends and does not
 * "continue the template" (which can trigger runaway repetition).
 *
 * PRIVACY: Subject + body are PII-redacted here (see ./redact) — this is the
 * single chokepoint through which all provider/tier requests pass, so no
 * high-confidence identifier (phone/email/account/card/ID) reaches the model.
 * `From` is intentionally left as-is: the AI needs it to derive the vendor, and
 * its disclosure is covered by the explicit user consent flow. */
export function buildUserPrompt(input: AiInput): string {
  const filenames = input.filenames?.length ? input.filenames.join(', ') : '(none)'
  return [
    'Classify the email between the markers and return only the JSON object.',
    '<<<EMAIL',
    `From: ${input.from ?? '(unknown)'}`,
    `Subject: ${redactPii(input.subject)}`,
    `Attachments: ${filenames}`,
    '',
    redactPii(input.body),
    'EMAIL>>>'
  ].join('\n')
}
