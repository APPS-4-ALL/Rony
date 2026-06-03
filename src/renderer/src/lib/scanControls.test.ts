import { describe, it, expect } from 'vitest'
import { progressLabel } from './scanControls'

describe('progressLabel', () => {
  const base = { matched: 0, downloaded: 0 }
  it('labels each phase', () => {
    expect(progressLabel({ ...base, phase: 'fetching', processed: 0, total: 0 })).toMatch(
      /Fetching/
    )
    expect(progressLabel({ ...base, phase: 'classifying', processed: 12, total: 50 })).toBe(
      'Scanning 12 of 50…'
    )
    expect(progressLabel({ ...base, phase: 'downloading', processed: 1, total: 1 })).toBe(
      'Downloading 1 of 1 file…'
    )
    expect(progressLabel({ ...base, phase: 'done', processed: 50, total: 50 })).toMatch(/Finishing/)
  })
})
