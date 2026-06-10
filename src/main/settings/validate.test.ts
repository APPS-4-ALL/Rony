import { describe, it, expect } from 'vitest'
import {
  coerceAiConsent,
  coerceAiProvider,
  coerceDefaultEngine,
  coerceDownloadDir,
  coerceFollowLinks,
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

  it('coerces the optional download folder (non-empty string, else null)', () => {
    expect(coerceDownloadDir('C:/Invoices')).toBe('C:/Invoices')
    expect(coerceDownloadDir('')).toBeNull()
    expect(coerceDownloadDir('   ')).toBeNull()
    expect(coerceDownloadDir(undefined)).toBeNull()
    expect(coerceDownloadDir(null)).toBeNull()
    expect(coerceDownloadDir(42)).toBeNull()
    expect(DEFAULT_SETTINGS.downloadDir).toBeNull()
  })

  it('defaults AI consent to false and only accepts true/"1" (privacy-first)', () => {
    expect(DEFAULT_SETTINGS.aiConsent).toBe(false)
    expect(coerceAiConsent('1')).toBe(true)
    expect(coerceAiConsent(true)).toBe(true)
    expect(coerceAiConsent('0')).toBe(false)
    expect(coerceAiConsent('true')).toBe(false) // only '1'/true count
    expect(coerceAiConsent(undefined)).toBe(false)
    expect(coerceAiConsent(null)).toBe(false)
  })

  it('defaults follow-links to false and only accepts true/"1" (RONY-18, no surprise requests)', () => {
    expect(DEFAULT_SETTINGS.followLinks).toBe(false)
    expect(coerceFollowLinks('1')).toBe(true)
    expect(coerceFollowLinks(true)).toBe(true)
    expect(coerceFollowLinks('0')).toBe(false)
    expect(coerceFollowLinks(undefined)).toBe(false)
    expect(coerceFollowLinks(null)).toBe(false)
  })
})
