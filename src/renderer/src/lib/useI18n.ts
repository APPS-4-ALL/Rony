/**
 * useI18n — the reactive glue over the pure i18n catalogue (i18n.ts).
 *
 * A single module-level `locale` ref is shared by every component that calls
 * `useI18n()`, so switching the language re-renders the whole app at once.
 * `setLocale` also mirrors the choice onto <html dir/lang> for proper RTL.
 */
import { ref, computed, type ComputedRef, type Ref } from 'vue'
import type { Locale } from '@shared/types'
import { dirForLocale, translate, type MessageKey } from './i18n'

/** Shared, app-wide current language. Hebrew is the default. */
const locale = ref<Locale>('he')

/** Apply the document direction + lang for the given locale (no-op outside a DOM). */
function applyDocumentLocale(next: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = next
  document.documentElement.dir = dirForLocale(next)
}

/** Switch the UI language (updates every component + the document direction). */
export function setLocale(next: Locale): void {
  locale.value = next
  applyDocumentLocale(next)
}

export interface UseI18n {
  /** The current language (reactive, read-only for callers). */
  locale: Ref<Locale>
  /** 'rtl' for Hebrew, 'ltr' for English (reactive). */
  dir: ComputedRef<'rtl' | 'ltr'>
  /** Translate a key in the current locale, with optional `{name}` params. */
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  /** Change the active language. */
  setLocale: (next: Locale) => void
}

/** Composable: reactive `t()` bound to the shared locale. */
export function useI18n(): UseI18n {
  const t = (key: MessageKey, params?: Record<string, string | number>): string =>
    translate(locale.value, key, params)
  const dir = computed(() => dirForLocale(locale.value))
  return { locale, dir, t, setLocale }
}
