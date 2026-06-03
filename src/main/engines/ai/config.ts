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
 * Default model per provider; override via OPENAI_MODEL / GEMINI_MODEL.
 * We default to the stronger tier (not the cheap "mini"/"flash" models): the AI
 * engine reads invoice PDFs/images to extract the total amount, and the larger
 * models are noticeably better at that document reading. Users who prefer
 * cheaper/faster runs can downgrade via the env override.
 */
const DEFAULT_MODELS: Record<AiProviderName, string> = {
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-pro'
}

/** Resolve which provider to use (explicit arg > env > default). */
export function resolveProvider(explicit?: AiProviderName): AiProviderName {
  const raw = (explicit ?? process.env.AI_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase()
  if (raw === 'openai' || raw === 'gemini') return raw
  throw new Error(`Unsupported AI_PROVIDER "${raw}" — use "openai" or "gemini".`)
}

/** Resolve the model for a provider (env override or default). */
export function getModel(provider: AiProviderName): string {
  const modelEnv = provider === 'openai' ? 'OPENAI_MODEL' : 'GEMINI_MODEL'
  return process.env[modelEnv]?.trim() || DEFAULT_MODELS[provider]
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
