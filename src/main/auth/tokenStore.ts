/**
 * RONY-6 — Secure token persistence.
 *
 * Tokens (access + refresh) are encrypted with Electron's `safeStorage`, which
 * uses the OS keychain/credential store (DPAPI on Windows, Keychain on macOS,
 * libsecret on Linux) to derive the key. The ciphertext is written to a file
 * under `userData`, so tokens survive restarts but are unreadable at rest
 * without the logged-in OS user's session.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { Credentials } from 'google-auth-library'

/** What we persist: Google's token set plus the resolved account email. */
export interface StoredAuth {
  tokens: Credentials
  email: string | null
}

function tokenFilePath(): string {
  return join(app.getPath('userData'), 'google-tokens.enc')
}

/** Encrypt and persist the auth bundle. Throws if OS encryption is unavailable. */
export function saveAuth(data: StoredAuth): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store tokens safely.')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(data))
  writeFileSync(tokenFilePath(), encrypted)
}

/** Load and decrypt the auth bundle, or null if absent/unreadable. */
export function loadAuth(): StoredAuth | null {
  const path = tokenFilePath()
  if (!existsSync(path)) return null
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    return JSON.parse(decrypted) as StoredAuth
  } catch {
    // Corrupt or undecryptable (e.g. different OS user) — treat as logged out.
    return null
  }
}

/** Delete stored tokens (logout). No-op if nothing is stored. */
export function clearAuth(): void {
  rmSync(tokenFilePath(), { force: true })
}
