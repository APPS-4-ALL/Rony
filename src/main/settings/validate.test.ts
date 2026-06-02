import { describe, it, expect } from 'vitest'
import { coerceDefaultEngine, DEFAULT_SETTINGS, isEngineType } from './validate'

describe('settings validation', () => {
  it('recognises the valid engine values', () => {
    expect(isEngineType('deterministic')).toBe(true)
    expect(isEngineType('ai')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isEngineType('AI')).toBe(false)
    expect(isEngineType('')).toBe(false)
    expect(isEngineType(undefined)).toBe(false)
    expect(isEngineType(42)).toBe(false)
  })

  it('coerces invalid/missing values to the default engine', () => {
    expect(coerceDefaultEngine('ai')).toBe('ai')
    expect(coerceDefaultEngine('deterministic')).toBe('deterministic')
    expect(coerceDefaultEngine(undefined)).toBe(DEFAULT_SETTINGS.defaultEngine)
    expect(coerceDefaultEngine('garbage')).toBe('deterministic')
  })
})
