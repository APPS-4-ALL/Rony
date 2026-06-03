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
import type { AiAttachment, AiInput, AiProviderName, AiResult, ProviderComplete } from './types'

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
  /**
   * Lazily fetch the document bytes. Called ONLY when the fast text pass decides
   * it needs the document (see `shouldEscalate`), so we never download an
   * attachment we won't use. If omitted, `input.attachments` is used instead.
   */
  loadAttachments?: () => Promise<AiAttachment[] | undefined>
}

/**
 * Decide whether the cheap text-only pass needs to escalate to the strong,
 * document-reading model. Pure + exported for unit testing. We escalate when:
 *  - the model explicitly asked for the document (`needsDocument`), OR
 *  - it judged the email financial but couldn't find the total `amount` (the
 *    amount almost always lives inside the attachment in that case).
 */
export function shouldEscalate(tier1: AiResult): boolean {
  return tier1.needsDocument === true || (tier1.isFinancial && tier1.amount === null)
}

/**
 * Two-tier classification (RONY-10): run the FAST model text-only first; only if
 * that pass can't finish the job (and a document is available) re-run on the
 * STRONG model with the attachment. `complete` is injected so this orchestration
 * is unit-testable without network. Returns the strong-pass result when we
 * escalate, else the fast-pass result.
 */
export async function classifyTiered(args: {
  complete: ProviderComplete
  system: string
  user: string
  apiKey: string
  fastModel: string
  strongModel: string
  loadAttachments?: () => Promise<AiAttachment[] | undefined>
}): Promise<AiResult> {
  const { complete, system, user, apiKey, fastModel, strongModel, loadAttachments } = args

  // Tier 1: fast model, text only.
  const tier1 = normalizeAiResult(
    await complete({ system, user, cfg: { apiKey, model: fastModel } })
  )
  if (!shouldEscalate(tier1)) return tier1

  // Tier 2: only if a document is actually available do we pay for the strong
  // model + vision; otherwise the fast result is the best we have.
  const attachments = await loadAttachments?.()
  if (!attachments || attachments.length === 0) return tier1

  return normalizeAiResult(
    await complete({ system, user, cfg: { apiKey, model: strongModel }, attachments })
  )
}

/**
 * Classify one email as financial-or-not and extract its fields via an LLM,
 * using the two-tier fast→strong strategy above.
 * Throws a readable error if the provider/key is unconfigured or the call fails.
 */
export async function classifyWithAI(
  input: AiInput,
  options: ClassifyOptions = {}
): Promise<AiResult> {
  const provider = resolveProvider(options.provider)
  // Resolve the key: explicit (user's stored key — RONY-16) wins; otherwise the
  // env-based dev fallback, which throws a helpful error when absent.
  const apiKey = options.apiKey ?? getProviderConfig(provider).apiKey
  const inputAttachments = input.attachments
  const loadAttachments =
    options.loadAttachments ??
    (inputAttachments ? async (): Promise<AiAttachment[]> => inputAttachments : undefined)

  return classifyTiered({
    complete: PROVIDERS[provider],
    system: AI_SYSTEM_PROMPT,
    user: buildUserPrompt(input),
    apiKey,
    fastModel: getModel(provider, 'fast'),
    strongModel: getModel(provider, 'strong'),
    loadAttachments
  })
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
    ...(obj.needsDocument === true ? { needsDocument: true } : {}),
    vendor: toStringOrNull(obj.vendor),
    amount: toAmountOrNull(obj.amount),
    currency: toStringOrNull(obj.currency),
    date: toIsoDateOrNull(obj.date)
  }
}

export type { AiInput, AiResult, AiProviderName } from './types'
