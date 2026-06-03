import { describe, it, expect } from 'vitest'
import { progressLabel } from './scanControls'

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
