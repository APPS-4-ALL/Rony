/**
 * RONY-10 — System/user prompt + the JSON shape we require from the model.
 *
 * The same prompt is used for every provider; only the transport differs.
 */
import type { AiInput } from './types'

/**
 * System prompt. Note the field ORDER in the required JSON: `reasoning` comes
 * first so the model writes its justification BEFORE committing to a verdict —
 * a lightweight chain-of-thought that measurably improves extraction quality.
 */
export const AI_SYSTEM_PROMPT = `You are a precise financial-document classifier for an invoice-scanning app.
Given one email (which may be in English or Hebrew), decide whether it is a
financial document such as an invoice, receipt, tax invoice (חשבונית מס),
or bill — and if so, extract its key fields.

Respond with ONLY a single JSON object (no markdown, no code fences, no extra
text) with EXACTLY these keys, in this order:

{
  "reasoning": string,        // 1-2 short sentences justifying your decision
  "isFinancial": boolean,     // true only for actual invoices/receipts/bills
  "confidenceScore": number,  // your confidence 0..1
  "vendor": string|null,      // the issuing business name, or null
  "amount": number|null,      // TOTAL amount as a RAW float, e.g. 1000.5
  "currency": string|null,    // ISO-4217 code, e.g. "ILS","USD", or null
  "date": string|null         // document date as "YYYY-MM-DD", or null
}

Rules:
- Read the ENTIRE email body before deciding — the relevant details (totals,
  dates, vendor) are often further down, especially in long reply threads.
- "amount" MUST be a plain number: strip currency symbols (₪, $), thousands
  separators (1,234.50 -> 1234.5) and trailing codes (ILS). Pick the grand
  total / amount due if several figures appear.
- Convert any date format (e.g. 01/05/2026, 1 May 2026) to "YYYY-MM-DD".
- If the email is NOT a financial document, set "isFinancial" false and set
  vendor, amount, currency and date to null.
- Never invent values you cannot find — use null instead.`

/** Build the per-email user message. The email is wrapped in explicit
 * delimiters so the model knows exactly where the content ends and does not
 * "continue the template" (which can trigger runaway repetition). */
export function buildUserPrompt(input: AiInput): string {
  const filenames = input.filenames?.length ? input.filenames.join(', ') : '(none)'
  return [
    'Classify the email between the markers and return only the JSON object.',
    '<<<EMAIL',
    `From: ${input.from ?? '(unknown)'}`,
    `Subject: ${input.subject}`,
    `Attachments: ${filenames}`,
    '',
    input.body,
    'EMAIL>>>'
  ].join('\n')
}
