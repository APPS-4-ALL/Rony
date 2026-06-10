import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getModel, resolveProvider } from './config'

const ENV_KEYS = [
  'AI_PROVIDER',
  'OPENAI_MODEL',
  'GEMINI_MODEL',
  'OPENAI_MODEL_FAST',
  'OPENAI_MODEL_STRONG',
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_STRONG',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_MODEL_FAST',
  'ANTHROPIC_MODEL_STRONG',
  'GROQ_MODEL_FAST',
  'GROQ_MODEL_STRONG'
]

beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]))
afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]))

describe('getModel — tiered model selection', () => {
  it('defaults to the cheap model for the fast tier', () => {
    expect(getModel('openai', 'fast')).toBe('gpt-4o-mini')
    expect(getModel('gemini', 'fast')).toBe('gemini-2.5-flash')
    expect(getModel('claude', 'fast')).toBe('claude-haiku-4-5')
    expect(getModel('groq', 'fast')).toBe('llama-3.1-8b-instant')
  })

  it('defaults to the strong model for the strong tier (and by default)', () => {
    expect(getModel('openai', 'strong')).toBe('gpt-4o')
    expect(getModel('gemini')).toBe('gemini-2.5-pro')
    expect(getModel('claude')).toBe('claude-opus-4-8')
    expect(getModel('groq', 'strong')).toBe('llama-3.3-70b-versatile')
  })

  it('honours per-tier env overrides (incl. the new providers)', () => {
    process.env.GEMINI_MODEL_FAST = 'gemini-flash-lite'
    process.env.OPENAI_MODEL_STRONG = 'o3'
    process.env.ANTHROPIC_MODEL_STRONG = 'claude-sonnet-4-6'
    process.env.GROQ_MODEL_FAST = 'llama-guard'
    expect(getModel('gemini', 'fast')).toBe('gemini-flash-lite')
    expect(getModel('openai', 'strong')).toBe('o3')
    expect(getModel('claude', 'strong')).toBe('claude-sonnet-4-6')
    expect(getModel('groq', 'fast')).toBe('llama-guard')
  })

  it('keeps the legacy single-model override applying to the strong tier', () => {
    process.env.OPENAI_MODEL = 'gpt-legacy'
    process.env.ANTHROPIC_MODEL = 'claude-legacy'
    expect(getModel('openai', 'strong')).toBe('gpt-legacy')
    expect(getModel('openai', 'fast')).toBe('gpt-4o-mini') // unaffected
    expect(getModel('claude', 'strong')).toBe('claude-legacy')
  })
})

describe('resolveProvider', () => {
  it('accepts all four providers (explicit arg or AI_PROVIDER env)', () => {
    for (const p of ['openai', 'gemini', 'claude', 'groq'] as const) {
      expect(resolveProvider(p)).toBe(p)
    }
    process.env.AI_PROVIDER = 'CLAUDE' // case-insensitive
    expect(resolveProvider()).toBe('claude')
  })

  it('throws on an unknown provider', () => {
    expect(() => resolveProvider('mistral' as never)).toThrow(/unsupported/i)
  })
})
