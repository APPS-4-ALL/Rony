/**
 * RONY-12 — Persisted app settings (SQLite-backed).
 *
 * Replaces the Step-0 in-memory stub: the default engine choice now survives
 * restarts, stored in the `app_settings` key/value table (RONY-3 DB).
 */
import { getSetting, setSetting } from '../db'
import type { Settings } from '../../shared/types'
import { coerceDefaultEngine } from './validate'

const KEY_DEFAULT_ENGINE = 'defaultEngine'

/** Read the current settings, applying defaults for anything unset/invalid. */
export function getSettings(): Settings {
  return {
    defaultEngine: coerceDefaultEngine(getSetting(KEY_DEFAULT_ENGINE))
  }
}

/** Apply a partial settings update, persist it, and return the new settings. */
export function updateSettings(patch: Partial<Settings>): Settings {
  if (patch.defaultEngine !== undefined) {
    setSetting(KEY_DEFAULT_ENGINE, coerceDefaultEngine(patch.defaultEngine))
  }
  return getSettings()
}
