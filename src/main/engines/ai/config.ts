/**
 * RONY-10 — AI engine configuration (provider selection + credentials).
 *
 * Keys and provider choice come from environment variables (a gitignored
 * `.env` in dev — see `.env.example`), mirroring the RONY-6 credentials pattern.
 */
import { config as loadDotenv } from 'dotenv'
import type { AiProviderName, ProviderConfig } from './types'

// Load `.env` from the project root in dev. dotenv does not override variables
// already present in the environment, so real env / test stubs win.
// `quiet` suppresses dotenv v17's promotional "tips" banner in the runtime log.
loadDotenv({ quiet: true })

/** Default provider when `AI_PROVIDER` is unset. */
const DEFAULT_PROVIDER: AiProviderName = 'openai'

/**
 * Two model tiers per provider (RONY-10 tiered scan):
 *  - `fast`: the cheap/quick model. Every email goes here FIRST, text-only, to
 *    classify and try to extract the fields from the email itself.
 *  - `strong`: the larger, document-reading model. We escalate to it (with the
 *    PDF/image attached) ONLY when the fast pass can't finish the job — e.g. the
 *    total amount lives inside the attachment. This keeps the expensive
 *    vision/reasoning calls to the minority of emails that actually need them.
 *
 * Overridable per tier via OPENAI_MODEL_FAST/OPENAI_MODEL_STRONG (and the GEMINI
 * equivalents). The legacy OPENAI_MODEL / GEMINI_MODEL still overrides `strong`,
 * preserving older `.env` files.
 */
export type ModelTier = 'fast' | 'strong'

const DEFAULT_MODELS: Record<ModelTier, Record<AiProviderName, string>> = {
  fast: { openai: 'gpt-4o-mini', gemini: 'gemini-2.5-flash' },
  strong: { openai: 'gpt-4o', gemini: 'gemini-2.5-pro' }
}

/** Resolve which provider to use (explicit arg > env > default). */
export function resolveProvider(explicit?: AiProviderName): AiProviderName {
  const raw = (explicit ?? process.env.AI_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase()
  if (raw === 'openai' || raw === 'gemini') return raw
  throw new Error(`Unsupported AI_PROVIDER "${raw}" — use "openai" or "gemini".`)
}

/** Resolve the model for a provider + tier (env override or default). */
export function getModel(provider: AiProviderName, tier: ModelTier = 'strong'): string {
  const prefix = provider === 'openai' ? 'OPENAI' : 'GEMINI'
  const tierEnv = process.env[`${prefix}_MODEL_${tier.toUpperCase()}`]?.trim()
  // Legacy single-model override still applies to the strong tier.
  const legacyEnv = tier === 'strong' ? process.env[`${prefix}_MODEL`]?.trim() : undefined
  return tierEnv || legacyEnv || DEFAULT_MODELS[tier][provider]
}

/**
 * Resolve the API key + model for a provider FROM THE ENVIRONMENT, or throw a
 * helpful error. Used as the dev fallback when no key was passed explicitly
 * (the app normally passes the user's stored key — RONY-16).
 */
export function getProviderConfig(provider: AiProviderName): ProviderConfig {
  const keyEnv = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'
  const apiKey = process.env[keyEnv]?.trim()
  if (!apiKey) {
    throw new Error(`${keyEnv} is not set — add your API key in Settings (or a .env for dev).`)
  }
  return { apiKey, model: getModel(provider) }
}
