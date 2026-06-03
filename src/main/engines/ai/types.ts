/**
 * RONY-10 — Advanced AI scan engine: shared types.
 *
 * Provider-agnostic: the rest of the app deals only in `AiInput` / `AiResult`
 * and never cares whether OpenAI or Gemini produced the answer.
 */

/** The supported external LLM providers. */
export type AiProviderName = 'openai' | 'gemini'

/**
 * One attachment's bytes, handed to a vision-capable model so it can read
 * fields (notably the TOTAL amount) that live inside the document rather than
 * in the email text. `mimeType` selects how the provider frames it
 * (`application/pdf` vs `image/*`).
 */
export interface AiAttachment {
  filename: string
  mimeType: string
  /** Raw file bytes (decoded from Gmail's base64url). */
  data: Buffer
}

/** The email content handed to the engine for classification/extraction. */
export interface AiInput {
  subject: string
  body: string
  /** Sender, when known — a useful vendor hint. */
  from?: string
  /** Attachment file names, e.g. ["invoice_2026.pdf"]. */
  filenames?: string[]
  /**
   * Attachment bytes for vision models (RONY-10 "טקסט מחולץ"). When present, the
   * provider sends the file alongside the prompt so the model can read the
   * amount from the document itself. Omitted → text-only classification.
   */
  attachments?: AiAttachment[]
}

/**
 * The normalized structured result every provider is coerced into.
 * Mirrors the fields the DoD asks for ({ isFinancial, vendor, amount, date }),
 * plus `currency`, a self-reported `confidenceScore`, and an optional
 * `reasoning` trail for debugging.
 */
export interface AiResult {
  /** Whether the model judged this to be a financial document (invoice/receipt). */
  isFinancial: boolean
  /**
   * The model's SELF-REPORTED confidence, 0..1. ⚠️ Not statistically calibrated —
   * LLMs tend to emit plausible-looking numbers that don't reflect true
   * probability. Treat as a soft UI heuristic only (e.g. "flag < 0.6 for human
   * review"), never as ground truth. Defaults to 0 when the model omits it, so
   * "unknown" errs toward being flagged for review.
   */
  confidenceScore: number
  /**
   * Short free-text justification for the classification — invaluable for
   * spotting hallucinations during debugging. Optional; may be absent.
   */
  reasoning?: string
  vendor: string | null
  /**
   * Numeric amount only — a raw float like `1000.5`. The prompt MUST enforce
   * this: NO currency symbols (`₪`, `$`), NO thousands separators (`1,234.50`),
   * NO trailing codes (`ILS`). Israeli invoices frequently mix these, so the
   * total is parsed/normalized to a plain number (currency goes in `currency`).
   */
  amount: number | null
  /** ISO-4217 code when known, e.g. "ILS", "USD". */
  currency: string | null
  /** Document date as ISO-8601 (YYYY-MM-DD). */
  date: string | null
}

/** Resolved per-provider runtime config (key + model). */
export interface ProviderConfig {
  apiKey: string
  model: string
}

/**
 * A provider adapter: given the system + user prompt, performs the HTTP call
 * and returns the model's raw text output (expected to be a JSON string).
 * Parsing/normalization happens centrally so all providers behave identically.
 *
 * When `attachments` are given, the adapter must send them to a vision-capable
 * model (Gemini `inlineData`, OpenAI Responses `input_file`/`input_image`) so
 * the model can read fields out of the document.
 */
export type ProviderComplete = (args: {
  system: string
  user: string
  cfg: ProviderConfig
  attachments?: AiAttachment[]
}) => Promise<string>
