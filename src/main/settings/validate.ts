/**
 * RONY-12/16 — Settings validation (pure, no DB/Electron imports).
 *
 * Kept separate from the DB-backed store so the validation/coercion can be
 * unit-tested in isolation.
 */
import type { AiProvider, EngineType, Locale, Settings } from '../../shared/types'

/** Used when nothing is stored yet, or a stored value is invalid/corrupt. */
export const DEFAULT_SETTINGS: Settings = {
  defaultEngine: 'deterministic',
  aiProvider: 'openai',
  locale: 'he'
}

/** Type guard for the scan-engine union. */
export function isEngineType(value: unknown): value is EngineType {
  return value === 'deterministic' || value === 'ai'
}

/** Coerce any raw/stored value into a valid engine, falling back to the default. */
export function coerceDefaultEngine(value: unknown): EngineType {
  return isEngineType(value) ? value : DEFAULT_SETTINGS.defaultEngine
}

/** Type guard for the AI-provider union (RONY-16). */
export function isAiProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'gemini'
}

/** Coerce any raw/stored value into a valid AI provider, falling back to the default. */
export function coerceAiProvider(value: unknown): AiProvider {
  return isAiProvider(value) ? value : DEFAULT_SETTINGS.aiProvider
}

/** Type guard for the UI-language union. */
export function isLocale(value: unknown): value is Locale {
  return value === 'he' || value === 'en'
}

/** Coerce any raw/stored value into a valid locale, falling back to the default. */
export function coerceLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_SETTINGS.locale
}
