import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getModel } from './config'

const ENV_KEYS = [
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'OPENAI_MODEL_FAST',
  'OPENAI_MODEL_STRONG',
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_STRONG'
]

beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]))
afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]))

describe('getModel — tiered model selection', () => {
  it('defaults to the cheap model for the fast tier', () => {
    expect(getModel('openai', 'fast')).toBe('gpt-4o-mini')
    expect(getModel('gemini', 'fast')).toBe('gemini-2.5-flash')
  })

  it('defaults to the strong model for the strong tier (and by default)', () => {
    expect(getModel('openai', 'strong')).toBe('gpt-4o')
    expect(getModel('gemini')).toBe('gemini-2.5-pro')
  })

  it('honours per-tier env overrides', () => {
    process.env.GEMINI_MODEL_FAST = 'gemini-flash-lite'
    process.env.OPENAI_MODEL_STRONG = 'o3'
    expect(getModel('gemini', 'fast')).toBe('gemini-flash-lite')
    expect(getModel('openai', 'strong')).toBe('o3')
  })

  it('keeps the legacy single-model override applying to the strong tier', () => {
    process.env.OPENAI_MODEL = 'gpt-legacy'
    expect(getModel('openai', 'strong')).toBe('gpt-legacy')
    expect(getModel('openai', 'fast')).toBe('gpt-4o-mini') // unaffected
  })
})
