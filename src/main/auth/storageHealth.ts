/**
 * Secure-storage health check.
 *
 * Tokens and API keys are protected with Electron `safeStorage`, which is backed
 * by DPAPI (Windows) / Keychain (macOS) — both hardware/user-session bound. On
 * LINUX, however, when no keyring (libsecret/kwallet) is available, `safeStorage`
 * silently falls back to the `basic_text` backend, which "encrypts" with a
 * HARDCODED key. `isEncryptionAvailable()` can still report `true` there, so the
 * data is effectively plaintext at rest.
 *
 * This module surfaces that condition so the app can warn the user (and so the
 * decision is explicit, not silent). Pure-ish: only touches Electron `safeStorage`.
 */
import { safeStorage } from 'electron'
import { logger } from '../lib/log'

export interface SecureStorageStatus {
  /** Whether `safeStorage` will encrypt at all. */
  available: boolean
  /**
   * Whether the backing store is a STRONG, OS-bound keystore (DPAPI / Keychain /
   * a real Linux keyring) rather than the hardcoded-key `basic_text` fallback.
   */
  strong: boolean
  /** The selected backend name on Linux (e.g. 'gnome_libsecret', 'basic_text'). */
  backend?: string
}

/** Inspect the secure-storage backend and whether it is trustworthy at rest. */
export function getSecureStorageStatus(): SecureStorageStatus {
  const available = safeStorage.isEncryptionAvailable()
  if (process.platform !== 'linux') {
    // DPAPI / Keychain are always OS-bound when available.
    return { available, strong: available }
  }
  // Linux: distinguish a real keyring from the weak basic_text fallback.
  const backend = safeStorage.getSelectedStorageBackend?.()
  const strong = available && backend !== 'basic_text' && backend !== undefined
  return { available, strong, backend }
}

/**
 * Log a clear warning at startup when secrets would be stored without a real
 * OS-bound keystore. Returns the status so the caller can also forward it to the
 * renderer (e.g. to show a banner in Settings).
 */
export function warnIfWeakSecureStorage(): SecureStorageStatus {
  const status = getSecureStorageStatus()
  if (!status.available) {
    logger.warn(
      '[security] OS secure storage is UNAVAILABLE — login and API keys cannot be ' +
        'stored safely on this system.'
    )
  } else if (!status.strong) {
    logger.warn(
      `[security] secure storage is using the weak "${status.backend}" backend ` +
        '(no OS keyring found). Tokens/API keys are NOT strongly protected at rest. ' +
        'Install a keyring (e.g. gnome-keyring / libsecret) for full protection.'
    )
  }
  return status
}
