/**
 * RONY-12 — Settings/Auth view helpers (pure, framework-free).
 *
 * Display data and small mappings for the Settings page, kept out of the Vue
 * component so they can be unit-tested without a DOM.
 */
import type { AiProvider, AuthStatus, EngineType } from '@shared/types'

/**
 * Consent-dialog copy shown before the AI engine can be enabled. Kept here (not
 * inline in the component) so the disclosure wording is reviewable in one place
 * and unit-testable. The user must accept this before any email content is sent
 * to a third-party AI provider.
 */
export const AI_CONSENT_TITLE = 'הפעלת סריקה חכמה (AI)'
export const AI_CONSENT_POINTS: readonly string[] = [
  'תוכן המיילים — הנושא וגוף ההודעה — יישלח לספק AI חיצוני (OpenAI או Gemini) לצורך סיווג וחילוץ פרטים.',
  'גם הקבצים המצורפים (PDF/תמונה) יישלחו לספק כדי לקרוא את הסכום מתוך המסמך.',
  'מזהים רגישים (טלפון, דוא"ל, מספרי חשבון/כרטיס, ת"ז) מוסתרים אוטומטית מהטקסט לפני השליחה.',
  'הסכום, התאריך ושם השולח נשמרים כדי לזהות את הספק והסכום.',
  'אפשר לבטל את ההסכמה בכל עת בהגדרות — הסריקה הרגילה (המקומית) אינה שולחת דבר החוצה.'
]

export interface ProviderOption {
  value: AiProvider
  label: string
}

/** The selectable AI providers, in display order (RONY-16). */
export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' }
]

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
