/**
 * RONY — encryption at rest for the sensitive invoice columns.
 *
 * `vendor`, `amount` and `email_body` are financial / PII data that were
 * previously written to the SQLite file as plaintext (protected only by file
 * permissions). We now encrypt them with Electron's `safeStorage` — the same
 * OS-keychain-backed mechanism already used for OAuth tokens and API keys
 * (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The ciphertext is
 * a Buffer, which better-sqlite3 binds as a BLOB; SQLite's column affinity
 * leaves BLOBs untouched, so the ciphertext lives in the existing columns with
 * no schema change.
 *
 * The encoding is SELF-DESCRIBING, which keeps reads backward/forward compatible:
 *  - a value read back as a Buffer (BLOB) is ciphertext  → decrypt it,
 *  - a value read back as a string/number is LEGACY plaintext (written before
 *    this change, or by the fallback path below) → return it unchanged.
 *
 * Fallback: when OS encryption is unavailable (e.g. a Linux box with no
 * keyring) we do NOT block writes — we store plaintext. A corrupt / lost invoice
 * list is a worse outcome than weaker-at-rest protection, and the storage-health
 * banner already warns the user when secure storage is weak. Decryption of a
 * value we cannot read (different OS user, corruption) degrades to null rather
 * than throwing, so the dashboard never crashes on one bad row.
 */
import { safeStorage } from 'electron'

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Encrypt a text field for storage. Returns a Buffer (BLOB) when OS encryption
 * is available, the original plaintext string as a fallback when it isn't, or
 * null for an absent value.
 */
export function encryptText(plain: string | null | undefined): Buffer | string | null {
  if (plain == null) return null
  if (!canEncrypt()) return plain
  return safeStorage.encryptString(plain)
}

/**
 * Decrypt a stored text field. A Buffer is ciphertext; a string is legacy
 * plaintext (passed through); anything undecryptable degrades to null.
 */
export function decryptText(stored: unknown): string | null {
  if (stored == null) return null
  if (Buffer.isBuffer(stored)) {
    try {
      return safeStorage.decryptString(stored)
    } catch {
      return null
    }
  }
  return typeof stored === 'string' ? stored : String(stored)
}

/**
 * Encrypt a numeric amount (serialised to text first). Returns a Buffer when OS
 * encryption is available, the original number as a fallback when it isn't, or
 * null for an absent value.
 */
export function encryptAmount(amount: number | null | undefined): Buffer | number | null {
  if (amount == null) return null
  if (!canEncrypt()) return amount
  return safeStorage.encryptString(String(amount))
}

/**
 * Decrypt a stored amount. A Buffer is ciphertext; a number is legacy plaintext
 * (passed through); anything that doesn't parse to a finite number is null.
 */
export function decryptAmount(stored: unknown): number | null {
  if (stored == null) return null
  if (Buffer.isBuffer(stored)) {
    try {
      const n = Number(safeStorage.decryptString(stored))
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }
  if (typeof stored === 'number') return stored
  const n = Number(stored)
  return Number.isFinite(n) ? n : null
}

/**
 * Idempotently convert a stored text value to its encrypted form: decrypt
 * (no-op for legacy plaintext) then re-encrypt. Used by the v1→v2 migration so
 * an interrupted/partial upgrade finishes cleanly on the next launch.
 */
export function ensureEncryptedText(stored: unknown): Buffer | string | null {
  return encryptText(decryptText(stored))
}

/** Idempotently convert a stored amount value to its encrypted form. */
export function ensureEncryptedAmount(stored: unknown): Buffer | number | null {
  return encryptAmount(decryptAmount(stored))
}
