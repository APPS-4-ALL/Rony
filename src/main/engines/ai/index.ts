/**
 * RONY-10 — Advanced AI scan engine (provider-agnostic entry point).
 *
 * `classifyWithAI()` builds the prompt, dispatches to the configured provider
 * (OpenAI or Gemini), and normalizes the raw model output into a strict
 * `AiResult`. The normalizer is the single source of robustness — it tolerates
 * markdown fences, missing/extra fields, and messy values (₪, thousands
 * separators, non-ISO dates) so the rest of the app always gets a clean result.
 *
 * ⚠️ Runs in the Electron MAIN process only (needs network + API keys). Kept
 * free of Electron imports so it stays unit-testable and script-runnable.
 */
import { getModel, getProviderConfig, resolveProvider } from './config'
import { AI_SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import { completeOpenAI } from './providers/openai'
import { completeGemini } from './providers/gemini'
import type { AiInput, AiProviderName, AiResult, ProviderComplete, ProviderConfig } from './types'

const PROVIDERS: Record<AiProviderName, ProviderComplete> = {
  openai: completeOpenAI,
  gemini: completeGemini
}

export interface ClassifyOptions {
  /** Override the provider for this call (else AI_PROVIDER env / default). */
  provider?: AiProviderName
  /**
   * Explicit API key (e.g. the user's key from secure storage — RONY-16).
   * When given, it overrides the env-based key; the model still comes from the
   * env override or the provider default.
   */
  apiKey?: string
}

/**
 * Classify one email as financial-or-not and extract its fields via an LLM.
 * Throws a readable error if the provider/key is unconfigured or the call fails.
 */
export async function classifyWithAI(
  input: AiInput,
  options: ClassifyOptions = {}
): Promise<AiResult> {
  const provider = resolveProvider(options.provider)
  const cfg: ProviderConfig = options.apiKey
    ? { apiKey: options.apiKey, model: getModel(provider) }
    : getProviderConfig(provider)
  const complete = PROVIDERS[provider]

  const raw = await complete({
    system: AI_SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    cfg,
    attachments: input.attachments
  })

  return normalizeAiResult(raw)
}

/* ----------------------------- normalization ----------------------------- */

/** Strip ```json … ``` fences a model may wrap around its JSON. */
function stripJsonFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

/** Trimmed non-empty string, else null. */
function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Coerce a model "amount" into a plain number. Handles numbers directly and
 * messy strings ("₪1,234.50", "1234.50 ILS", "1000.50 (ID: 123)") by removing
 * thousands-separator commas and then extracting ONLY the first continuous
 * number — so trailing text can never be concatenated into a corrupted value.
 * Returns null when nothing numeric is present.
 */
function toAmountOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number.parseFloat(match[0]) : null
}

/**
 * Accept a date only if it is strictly `YYYY-MM-DD` AND a real calendar date
 * (rejects e.g. "2026-13-45"); otherwise null. Keeps `invoices.date` clean for
 * sorting / display / CSV export downstream.
 */
function toIsoDateOrNull(value: unknown): string | null {
  const s = toStringOrNull(value)
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  return real ? s : null
}

/** Clamp a self-reported confidence into [0,1]; default 0 ("review me"). */
function toConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Parse + validate raw model text into a strict AiResult. Exported for unit
 * tests and reuse. Throws if the text is not JSON at all.
 */
export function normalizeAiResult(raw: string): AiResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFences(raw))
  } catch {
    throw new Error(`AI returned non-JSON output: ${raw.slice(0, 200)}`)
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>

  const reasoning = toStringOrNull(obj.reasoning)
  return {
    isFinancial: obj.isFinancial === true,
    confidenceScore: toConfidence(obj.confidenceScore),
    ...(reasoning ? { reasoning } : {}),
    vendor: toStringOrNull(obj.vendor),
    amount: toAmountOrNull(obj.amount),
    currency: toStringOrNull(obj.currency),
    date: toIsoDateOrNull(obj.date)
  }
}

export type { AiInput, AiResult, AiProviderName } from './types'
