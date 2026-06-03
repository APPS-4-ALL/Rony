/**
 * RONY-12/16 — Persisted app settings (SQLite-backed).
 *
 * Replaces the Step-0 in-memory stub: the default engine + AI provider choices
 * survive restarts, stored in the `app_settings` key/value table (RONY-3 DB).
 * (API keys are NOT here — they live encrypted in ./apiKeyStore.)
 */
import { getSetting, setSetting } from '../db'
import type { Settings } from '../../shared/types'
import { coerceAiProvider, coerceDefaultEngine, coerceLocale } from './validate'

const KEY_DEFAULT_ENGINE = 'defaultEngine'
const KEY_AI_PROVIDER = 'aiProvider'
const KEY_LOCALE = 'locale'

/** Read the current settings, applying defaults for anything unset/invalid. */
export function getSettings(): Settings {
  return {
    defaultEngine: coerceDefaultEngine(getSetting(KEY_DEFAULT_ENGINE)),
    aiProvider: coerceAiProvider(getSetting(KEY_AI_PROVIDER)),
    locale: coerceLocale(getSetting(KEY_LOCALE))
  }
}

/** Apply a partial settings update, persist it, and return the new settings. */
export function updateSettings(patch: Partial<Settings>): Settings {
  if (patch.defaultEngine !== undefined) {
    setSetting(KEY_DEFAULT_ENGINE, coerceDefaultEngine(patch.defaultEngine))
  }
  if (patch.aiProvider !== undefined) {
    setSetting(KEY_AI_PROVIDER, coerceAiProvider(patch.aiProvider))
  }
  if (patch.locale !== undefined) {
    setSetting(KEY_LOCALE, coerceLocale(patch.locale))
  }
  return getSettings()
}
