import { describe, it, expect } from 'vitest'
import { progressLabel, COUNT_OPTIONS, RANGE_PRESETS, isoDaysAgo, rangeDays } from './scanControls'

describe('progressLabel', () => {
  const base = { matched: 0, downloaded: 0 }
  it('labels each phase in Hebrew', () => {
    expect(progressLabel({ ...base, phase: 'fetching', processed: 0, total: 0 })).toBe(
      'מאחזר הודעות…'
    )
    expect(progressLabel({ ...base, phase: 'classifying', processed: 12, total: 50 })).toBe(
      'סורק 12 מתוך 50…'
    )
    expect(progressLabel({ ...base, phase: 'downloading', processed: 1, total: 1 })).toBe(
      'מוריד 1 מתוך 1 קובץ…'
    )
    expect(progressLabel({ ...base, phase: 'downloading', processed: 2, total: 5 })).toBe(
      'מוריד 2 מתוך 5 קבצים…'
    )
    expect(progressLabel({ ...base, phase: 'done', processed: 50, total: 50 })).toBe('מסיים…')
  })
})

describe('scan range presets', () => {
  it('computes an ISO date N days before a given day', () => {
    const from = new Date('2026-06-04T09:00:00Z')
    expect(isoDaysAgo(7, from)).toBe('2026-05-28')
    expect(isoDaysAgo(365, from)).toBe('2025-06-04')
  })

  it('maps preset keys to their look-back window', () => {
    expect(rangeDays('week')).toBe(7)
    expect(rangeDays('month')).toBe(30)
    expect(rangeDays('quarter')).toBe(90)
    expect(rangeDays('year')).toBe(365)
    expect(rangeDays('custom')).toBeNull()
  })

  it('offers the presets in order, ending with custom', () => {
    expect(RANGE_PRESETS.map((p) => p.key)).toEqual(['week', 'month', 'quarter', 'year', 'custom'])
  })

  it('offers message-count caps up to the 1000 server limit', () => {
    expect(COUNT_OPTIONS).toContain(50)
    expect(COUNT_OPTIONS[COUNT_OPTIONS.length - 1]).toBe(1000)
  })
})
