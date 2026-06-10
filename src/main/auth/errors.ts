/**
 * Detecting an expired/revoked Google OAuth grant.
 *
 * When Google's token endpoint answers a refresh with `invalid_grant`, the
 * stored refresh token is dead — expired (apps in "Testing" publishing status
 * have their refresh tokens expire after ~7 days) or revoked — and cannot be
 * recovered without a fresh interactive login. We surface this as a distinct,
 * user-readable error so the UI can prompt a reconnect instead of leaking a raw
 * OAuth stack trace (`invalid_grant`) into the scan error box.
 *
 * Pure (no Electron/network imports) so it unit-tests in isolation.
 */

/** Thrown when the Gmail connection has expired/been revoked and the user must reconnect. */
export class AuthExpiredError extends Error {
  constructor(message = 'החיבור ל-Gmail פג או בוטל. יש להתחבר מחדש דרך מסך ההגדרות.') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

/**
 * True when `error` is Google's `invalid_grant` (an expired/revoked refresh
 * token). Checks the structured Gaxios response body first, then falls back to
 * the error message text (some code paths only carry the string).
 */
export function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { response?: { data?: { error?: string } }; message?: unknown }
  if (e.response?.data?.error === 'invalid_grant') return true
  return typeof e.message === 'string' && e.message.includes('invalid_grant')
}
