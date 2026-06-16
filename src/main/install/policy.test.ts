import { describe, it, expect } from 'vitest'
import { shouldPing } from './policy'

describe('install-ping policy (RONY-20)', () => {
  it('pings only when consented, secret present, and not yet counted', () => {
    expect(shouldPing({ consent: true, hasSecret: true, alreadyPinged: false })).toBe(true)
  })

  it('never pings without consent (opt-in, privacy-first)', () => {
    expect(shouldPing({ consent: false, hasSecret: true, alreadyPinged: false })).toBe(false)
  })

  it('never pings when no secret is configured (backend not wired)', () => {
    expect(shouldPing({ consent: true, hasSecret: false, alreadyPinged: false })).toBe(false)
  })

  it('never pings twice — already-counted installs stay silent', () => {
    expect(shouldPing({ consent: true, hasSecret: true, alreadyPinged: true })).toBe(false)
  })
})
