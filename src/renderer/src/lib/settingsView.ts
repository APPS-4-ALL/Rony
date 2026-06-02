/**
 * RONY-12 — Settings/Auth view helpers (pure, framework-free).
 *
 * Display data and small mappings for the Settings page, kept out of the Vue
 * component so they can be unit-tested without a DOM.
 */
import type { AuthStatus, EngineType } from '@shared/types'

export interface EngineOption {
  value: EngineType
  label: string
  description: string
}

/** The selectable default scan engines, in display order. */
export const ENGINE_OPTIONS: readonly EngineOption[] = [
  {
    value: 'deterministic',
    label: 'Deterministic',
    description: 'Fast local keyword/Regex matching. No API key — fully offline.'
  },
  {
    value: 'ai',
    label: 'AI (Advanced)',
    description: 'Sends email text to an LLM to classify + extract fields. Requires an API key.'
  }
]

export interface ConnectionDisplay {
  connected: boolean
  /** Short status word for the badge. */
  label: string
  /** Secondary line: the account email, or a hint when disconnected. */
  detail: string
  /** Tailwind class for the status dot. */
  badgeColor: string
  /** Tailwind class for the status label text. */
  textColor: string
}

/** Map an AuthStatus into the bits the Settings view renders (incl. colors). */
export function connectionDisplay(status: AuthStatus): ConnectionDisplay {
  if (status.connected) {
    return {
      connected: true,
      label: 'Connected',
      detail: status.email ?? 'Gmail account',
      badgeColor: 'bg-emerald-400',
      textColor: 'text-emerald-300'
    }
  }
  return {
    connected: false,
    label: 'Disconnected',
    detail: 'Not connected to Gmail',
    badgeColor: 'bg-slate-600',
    textColor: 'text-slate-300'
  }
}
