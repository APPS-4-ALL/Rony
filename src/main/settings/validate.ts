/**
 * RONY-12/16 — Settings validation (pure, no DB/Electron imports).
 *
 * Kept separate from the DB-backed store so the validation/coercion can be
 * unit-tested in isolation.
 */
import type { AiProvider, EngineType, Settings, Theme } from '../../shared/types'

/** Used when nothing is stored yet, or a stored value is invalid/corrupt. */
export const DEFAULT_SETTINGS: Settings = {
  defaultEngine: 'deterministic',
  aiProvider: 'openai',
  downloadDir: null,
  // Privacy: the AI engine is OPT-IN. Until the user accepts the consent dialog,
  // no email content is sent to a third-party AI provider.
  aiConsent: false,
  // RONY-18: following invoice links makes outbound requests to vendor sites — OFF by default.
  followLinks: false,
  // UI theme — dark by default (Rony's original look).
  theme: 'dark'
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

/**
 * Coerce a raw/stored download-folder value: a non-empty string is the user's
 * custom folder; anything else (empty, null, non-string) means "use the default".
 */
export function coerceDownloadDir(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Coerce a raw/stored AI-consent value to a strict boolean. Consent is stored as
 * the string '1' (true) / '0' (false); ANY other value reads as `false`, so a
 * missing or corrupt entry safely defaults to "not consented" (privacy-first).
 */
export function coerceAiConsent(value: unknown): boolean {
  return value === true || value === '1'
}

/**
 * Coerce a raw/stored follow-links value to a strict boolean (RONY-18). Stored
 * as '1'/'0'; anything else reads as `false`, so a missing/corrupt entry safely
 * defaults to "don't follow links" (no surprise outbound requests).
 */
export function coerceFollowLinks(value: unknown): boolean {
  return value === true || value === '1'
}

/** Type guard for the UI theme union. */
export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

/** Coerce a raw/stored theme to a valid value, defaulting to dark. */
export function coerceTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_SETTINGS.theme
}
