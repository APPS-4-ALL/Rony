/**
 * RONY-12/16 — Persisted app settings (SQLite-backed).
 *
 * Replaces the Step-0 in-memory stub: the default engine + AI provider choices
 * survive restarts, stored in the `app_settings` key/value table (RONY-3 DB).
 * (API keys are NOT here — they live encrypted in ./apiKeyStore.)
 */
import { getSetting, setSetting } from '../db'
import type { Settings } from '../../shared/types'
import {
  coerceAiConsent,
  coerceAiProvider,
  coerceBusinessName,
  coerceDefaultEngine,
  coerceDownloadDir,
  coerceFollowLinks,
  coerceInstallConsent,
  coerceOnboardingComplete,
  coerceTaxId,
  coerceTheme
} from './validate'

const KEY_DEFAULT_ENGINE = 'defaultEngine'
const KEY_AI_PROVIDER = 'aiProvider'
const KEY_DOWNLOAD_DIR = 'downloadDir'
const KEY_AI_CONSENT = 'aiConsent'
const KEY_FOLLOW_LINKS = 'followLinks'
const KEY_INSTALL_CONSENT = 'installConsent'
const KEY_THEME = 'theme'
const KEY_BUSINESS_NAME_HE = 'businessNameHe'
const KEY_BUSINESS_NAME_EN = 'businessNameEn'
const KEY_TAX_ID = 'taxId'
const KEY_ONBOARDING_COMPLETE = 'onboardingComplete'

/** Read the current settings, applying defaults for anything unset/invalid. */
export function getSettings(): Settings {
  return {
    defaultEngine: coerceDefaultEngine(getSetting(KEY_DEFAULT_ENGINE)),
    aiProvider: coerceAiProvider(getSetting(KEY_AI_PROVIDER)),
    downloadDir: coerceDownloadDir(getSetting(KEY_DOWNLOAD_DIR)),
    aiConsent: coerceAiConsent(getSetting(KEY_AI_CONSENT)),
    followLinks: coerceFollowLinks(getSetting(KEY_FOLLOW_LINKS)),
    installConsent: coerceInstallConsent(getSetting(KEY_INSTALL_CONSENT)),
    theme: coerceTheme(getSetting(KEY_THEME)),
    businessNameHe: coerceBusinessName(getSetting(KEY_BUSINESS_NAME_HE)),
    businessNameEn: coerceBusinessName(getSetting(KEY_BUSINESS_NAME_EN)),
    taxId: coerceTaxId(getSetting(KEY_TAX_ID)),
    onboardingComplete: coerceOnboardingComplete(getSetting(KEY_ONBOARDING_COMPLETE))
  }
}

/** Apply a partial settings update, persist it, and return the new settings. */
export function updateSettings(patch: Partial<Settings>): Settings {
  if (patch.defaultEngine !== undefined) {
    setSetting(KEY_DEFAULT_ENGINE, coerceDefaultEngine(patch.defaultEngine))
  }
  if (patch.aiProvider !== undefined) {
    setSetting(KEY_AI_PROVIDER, coerceAiProvider(patch.aiProvider))
  }
  if (patch.downloadDir !== undefined) {
    // Store '' to mean "default"; coerceDownloadDir maps it back to null on read.
    setSetting(KEY_DOWNLOAD_DIR, coerceDownloadDir(patch.downloadDir) ?? '')
  }
  if (patch.aiConsent !== undefined) {
    // Stored as '1'/'0' (see coerceAiConsent); anything else reads back as false.
    setSetting(KEY_AI_CONSENT, coerceAiConsent(patch.aiConsent) ? '1' : '0')
  }
  if (patch.followLinks !== undefined) {
    setSetting(KEY_FOLLOW_LINKS, coerceFollowLinks(patch.followLinks) ? '1' : '0')
  }
  if (patch.installConsent !== undefined) {
    setSetting(KEY_INSTALL_CONSENT, coerceInstallConsent(patch.installConsent) ? '1' : '0')
  }
  if (patch.theme !== undefined) {
    setSetting(KEY_THEME, coerceTheme(patch.theme))
  }
  if (patch.businessNameHe !== undefined) {
    setSetting(KEY_BUSINESS_NAME_HE, coerceBusinessName(patch.businessNameHe) ?? '')
  }
  if (patch.businessNameEn !== undefined) {
    setSetting(KEY_BUSINESS_NAME_EN, coerceBusinessName(patch.businessNameEn) ?? '')
  }
  if (patch.taxId !== undefined) {
    setSetting(KEY_TAX_ID, coerceTaxId(patch.taxId) ?? '')
  }
  if (patch.onboardingComplete !== undefined) {
    setSetting(
      KEY_ONBOARDING_COMPLETE,
      coerceOnboardingComplete(patch.onboardingComplete) ? '1' : '0'
    )
  }
  return getSettings()
}
