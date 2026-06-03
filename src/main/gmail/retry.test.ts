import { describe, it, expect } from 'vitest'
import { backoffMs, isTransientStatus } from './retry'

describe('isTransientStatus', () => {
  it('retries on 429 and any 5xx', () => {
    expect(isTransientStatus(429)).toBe(true)
    expect(isTransientStatus(500)).toBe(true)
    expect(isTransientStatus(503)).toBe(true)
  })

  it('does not retry on other 4xx, 2xx, or unknown', () => {
    expect(isTransientStatus(400)).toBe(false)
    expect(isTransientStatus(401)).toBe(false)
    expect(isTransientStatus(404)).toBe(false)
    expect(isTransientStatus(200)).toBe(false)
    expect(isTransientStatus(undefined)).toBe(false)
  })
})

describe('backoffMs', () => {
  it('grows from ~500ms and caps near 8s', () => {
    expect(backoffMs(0)).toBeGreaterThanOrEqual(500)
    expect(backoffMs(1)).toBeGreaterThanOrEqual(1000)
    expect(backoffMs(2)).toBeGreaterThanOrEqual(2000)
    // capped at 8000 (+ up to 250ms jitter) no matter how high the attempt
    expect(backoffMs(10)).toBeLessThanOrEqual(8000 + 250)
  })
})
