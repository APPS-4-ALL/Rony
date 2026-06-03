/**
 * Scan progress label (pure, framework-free). Hebrew-only.
 */
import type { ScanProgress } from '@shared/types'

/** A human label for the current scan progress, e.g. "סורק 12 מתוך 50…". */
export function progressLabel(p: ScanProgress): string {
  switch (p.phase) {
    case 'fetching':
      return 'מאחזר הודעות…'
    case 'classifying':
      return `סורק ${p.processed} מתוך ${p.total}…`
    case 'downloading':
      return `מוריד ${p.processed} מתוך ${p.total} ${p.total === 1 ? 'קובץ' : 'קבצים'}…`
    case 'done':
      return 'מסיים…'
  }
}
