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

/** Default model per provider; override via OPENAI_MODEL / GEMINI_MODEL. */
const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash'
}

/** Resolve which provider to use (explicit arg > env > default). */
export function resolveProvider(explicit?: AiProviderName): AiProviderName {
  const raw = (explicit ?? process.env.AI_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase()
  if (raw === 'openai' || raw === 'gemini') return raw
  throw new Error(`Unsupported AI_PROVIDER "${raw}" — use "openai" or "gemini".`)
}

/** Resolve the API key + model for a provider, or throw a helpful error. */
export function getProviderConfig(provider: AiProviderName): ProviderConfig {
  const keyEnv = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'
  const modelEnv = provider === 'openai' ? 'OPENAI_MODEL' : 'GEMINI_MODEL'

  const apiKey = process.env[keyEnv]?.trim()
  if (!apiKey) {
    throw new Error(`${keyEnv} is not set — configure it in your .env (see .env.example).`)
  }
  const model = process.env[modelEnv]?.trim() || DEFAULT_MODELS[provider]
  return { apiKey, model }
}
