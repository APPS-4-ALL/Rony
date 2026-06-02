import { describe, it, expect } from 'vitest'
import {
  coerceAiProvider,
  coerceDefaultEngine,
  DEFAULT_SETTINGS,
  isAiProvider,
  isEngineType
} from './validate'

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

  it('recognises + coerces the AI provider (RONY-16)', () => {
    expect(isAiProvider('openai')).toBe(true)
    expect(isAiProvider('gemini')).toBe(true)
    expect(isAiProvider('claude')).toBe(false)
    expect(isAiProvider(undefined)).toBe(false)
    expect(coerceAiProvider('gemini')).toBe('gemini')
    expect(coerceAiProvider('garbage')).toBe(DEFAULT_SETTINGS.aiProvider)
    expect(coerceAiProvider(undefined)).toBe('openai')
  })
})
