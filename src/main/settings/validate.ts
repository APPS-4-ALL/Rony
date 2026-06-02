/**
 * RONY-12 — Settings validation (pure, no DB/Electron imports).
 *
 * Kept separate from the DB-backed store so the validation/coercion can be
 * unit-tested in isolation.
 */
import type { EngineType, Settings } from '../../shared/types'

/** Used when nothing is stored yet, or a stored value is invalid/corrupt. */
export const DEFAULT_SETTINGS: Settings = { defaultEngine: 'deterministic' }

/** Type guard for the scan-engine union. */
export function isEngineType(value: unknown): value is EngineType {
  return value === 'deterministic' || value === 'ai'
}

/** Coerce any raw/stored value into a valid engine, falling back to the default. */
export function coerceDefaultEngine(value: unknown): EngineType {
  return isEngineType(value) ? value : DEFAULT_SETTINGS.defaultEngine
}
