import { describe, it, expect } from 'vitest'
import { sanitizeScanOptions, MAX_ALLOWED_RESULTS } from './options'

describe('sanitizeScanOptions', () => {
  it('returns an empty object for non-object / missing input', () => {
    expect(sanitizeScanOptions(undefined)).toEqual({})
    expect(sanitizeScanOptions(null)).toEqual({})
    expect(sanitizeScanOptions('50')).toEqual({})
    expect(sanitizeScanOptions(42)).toEqual({})
  })

  it('keeps a valid whole-number maxResults', () => {
    expect(sanitizeScanOptions({ maxResults: 100 })).toEqual({ maxResults: 100 })
    expect(sanitizeScanOptions({ maxResults: 12.9 })).toEqual({ maxResults: 12 }) // floored
  })

  it('clamps maxResults to [1, MAX] and drops out-of-range / non-numeric', () => {
    expect(sanitizeScanOptions({ maxResults: 0 })).toEqual({})
    expect(sanitizeScanOptions({ maxResults: -5 })).toEqual({})
    expect(sanitizeScanOptions({ maxResults: 99999 })).toEqual({ maxResults: MAX_ALLOWED_RESULTS })
    expect(sanitizeScanOptions({ maxResults: Number.NaN })).toEqual({})
    expect(sanitizeScanOptions({ maxResults: '50' })).toEqual({})
  })

  it('keeps ISO YYYY-MM-DD date bounds and drops malformed ones', () => {
    expect(sanitizeScanOptions({ after: '2026-01-01', before: '2026-06-01' })).toEqual({
      after: '2026-01-01',
      before: '2026-06-01'
    })
    expect(sanitizeScanOptions({ after: '01/01/2026' })).toEqual({})
    expect(sanitizeScanOptions({ before: 'yesterday' })).toEqual({})
    expect(sanitizeScanOptions({ after: 20260101 })).toEqual({})
  })

  it('combines a valid count with a partial date range', () => {
    expect(sanitizeScanOptions({ maxResults: 25, after: '2026-03-01', before: 'nope' })).toEqual({
      maxResults: 25,
      after: '2026-03-01'
    })
  })
})
