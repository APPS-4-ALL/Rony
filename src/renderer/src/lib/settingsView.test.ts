import { describe, it, expect } from 'vitest'
import { connectionDisplay, ENGINE_OPTIONS, PROVIDER_OPTIONS } from './settingsView'

describe('ENGINE_OPTIONS', () => {
  it('offers exactly the two engines, deterministic first', () => {
    expect(ENGINE_OPTIONS.map((o) => o.value)).toEqual(['deterministic', 'ai'])
    for (const o of ENGINE_OPTIONS) expect(o.label && o.description).toBeTruthy()
  })
})

describe('PROVIDER_OPTIONS', () => {
  it('offers OpenAI, Gemini, Claude + Groq with labels', () => {
    expect(PROVIDER_OPTIONS.map((o) => o.value)).toEqual(['openai', 'gemini', 'claude', 'groq'])
    for (const o of PROVIDER_OPTIONS) expect(o.label).toBeTruthy()
  })
})

describe('connectionDisplay', () => {
  it('shows the account email + connected colors', () => {
    expect(connectionDisplay({ connected: true, email: 'me@gmail.com' })).toEqual({
      connected: true,
      label: 'Connected',
      detail: 'me@gmail.com',
      badgeColor: 'bg-emerald-400',
      textColor: 'text-emerald-300'
    })
  })

  it('falls back gracefully when connected without an email', () => {
    expect(connectionDisplay({ connected: true, email: null }).detail).toBe('Gmail account')
  })

  it('reports a disconnected state with muted colors', () => {
    expect(connectionDisplay({ connected: false, email: null })).toMatchObject({
      connected: false,
      label: 'Disconnected',
      badgeColor: 'bg-slate-600',
      textColor: 'text-slate-300'
    })
  })
})
