/**
 * RONY-6 — OAuth client credentials + scopes.
 *
 * The Google OAuth *Desktop app* client ID and secret are provided by the
 * user via environment variables (a gitignored `.env` in dev — see
 * `.env.example`). For an installed/desktop app the "secret" is not truly
 * secret (RFC 8252), but we still keep it out of source control.
 */
import { config as loadDotenv } from 'dotenv'

// Load `.env` from the project root in dev. In a packaged build there is no
// `.env`; the variables must already be present in the process environment.
loadDotenv()

/**
 * The Gmail read-only scope — read messages + download attachments (RONY-7/11).
 * Read-only is intentional: Rony never modifies the user's mailbox. Exported so
 * the login flow can verify the user actually GRANTED it (Google lets users
 * decline individual scopes on the granular-consent screen).
 */
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/**
 * OAuth scopes we request:
 *  - openid + userinfo.email → so we can show which account is connected.
 *  - gmail.readonly          → read messages + download attachments (RONY-7/11).
 */
export const OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  GMAIL_READONLY_SCOPE
]

export interface OAuthCredentials {
  clientId: string
  clientSecret: string
}

/**
 * Returns the configured OAuth credentials, or null if the user hasn't set
 * them up yet (so the UI can show a helpful "configure credentials" message
 * instead of crashing).
 */
export function getOAuthCredentials(): OAuthCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}
