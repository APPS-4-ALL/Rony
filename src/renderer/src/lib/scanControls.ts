/**
 * Scan progress label (pure, framework-free).
 */
import type { ScanProgress } from '@shared/types'

/** A human label for the current scan progress, e.g. "Scanning 12 of 50…". */
export function progressLabel(p: ScanProgress): string {
  switch (p.phase) {
    case 'fetching':
      return 'Fetching messages…'
    case 'classifying':
      return `Scanning ${p.processed} of ${p.total}…`
    case 'downloading':
      return `Downloading ${p.processed} of ${p.total} file${p.total === 1 ? '' : 's'}…`
    case 'done':
      return 'Finishing…'
  }
}
