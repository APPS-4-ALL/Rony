/**
 * RONY-6 — Google OAuth 2.0 desktop (loopback) flow.
 *
 * Flow (RFC 8252 "Loopback IP redirect"):
 *  1. Start a throwaway HTTP server on 127.0.0.1:<random-port>.
 *  2. Open the user's real browser to Google's consent screen, with that
 *     loopback URL as the redirect_uri.
 *  3. Google redirects back to the loopback server with an authorization code.
 *  4. Exchange the code for access + refresh tokens, store them encrypted.
 *
 * This is Google's recommended pattern for desktop apps — no embedded webview,
 * the user authenticates in their trusted browser.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { type AddressInfo } from 'node:net'
import { shell } from 'electron'
import { OAuth2Client } from 'google-auth-library'
import type { AuthStatus } from '../../shared/types'
import { getOAuthCredentials, OAUTH_SCOPES } from './credentials'
import { clearAuth, loadAuth, saveAuth } from './tokenStore'

/** How long we wait for the user to finish consenting before giving up. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

/** Handle to the in-flight login, so a new attempt can cancel a stuck one. */
let activeAttempt: { cancel: (reason: string) => void } | null = null

/** Minimal HTML shown in the browser tab once the redirect lands. */
function resultPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Rony</title></head>
<body style="font-family:system-ui;background:#020617;color:#e2e8f0;display:flex;
height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center"><h2>${message}</h2>
<p style="color:#94a3b8">You can close this tab and return to Rony.</p></div></body></html>`
}

/** Decode the email claim from a Google id_token (no verification needed — it
 * arrived directly from Google over TLS during the code exchange). */
function emailFromIdToken(idToken: string | null | undefined): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    const json = Buffer.from(payload, 'base64url').toString('utf-8')
    return (JSON.parse(json).email as string) ?? null
  } catch {
    return null
  }
}

/** Current connection status, derived from stored tokens. */
export function getAuthStatus(): AuthStatus {
  const stored = loadAuth()
  return stored?.tokens
    ? { connected: true, email: stored.email }
    : { connected: false, email: null }
}

/** Forget stored tokens. */
export function logout(): AuthStatus {
  clearAuth()
  return { connected: false, email: null }
}

/**
 * Run the interactive login flow. Resolves with the resulting AuthStatus once
 * tokens are stored, or rejects with a user-readable error.
 */
export function login(): Promise<AuthStatus> {
  // Supersede any previous (possibly stuck) attempt so the user can always retry.
  if (activeAttempt) {
    activeAttempt.cancel('Login restarted by a new attempt.')
    activeAttempt = null
  }

  const creds = getOAuthCredentials()
  if (!creds) {
    return Promise.reject(
      new Error(
        'Google OAuth credentials are not configured. Set GOOGLE_CLIENT_ID and ' +
          'GOOGLE_CLIENT_SECRET (see .env.example).'
      )
    )
  }

  const expectedState = randomBytes(16).toString('hex')

  return new Promise<AuthStatus>((resolve, reject) => {
    const server = createServer()
    let settled = false

    const finish = (err: Error | null, status?: AuthStatus): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      if (activeAttempt === attempt) activeAttempt = null
      if (err) reject(err)
      else resolve(status as AuthStatus)
    }

    const attempt = { cancel: (reason: string): void => finish(new Error(reason)) }
    activeAttempt = attempt

    const timer = setTimeout(
      () => finish(new Error('Login timed out — no response from Google.')),
      LOGIN_TIMEOUT_MS
    )

    server.on('request', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      // Ignore stray requests (e.g. favicon) that carry no auth params.
      if (!code && !error) {
        res.writeHead(204).end()
        return
      }

      const respond = (msg: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(resultPage(msg))
      }

      if (error) {
        respond('Login cancelled.')
        finish(new Error(`Google returned an error: ${error}`))
        return
      }
      if (state !== expectedState) {
        respond('Login failed (state mismatch).')
        finish(new Error('OAuth state mismatch — possible CSRF, aborting.'))
        return
      }

      // Valid code — exchange it for tokens.
      const { port } = server.address() as AddressInfo
      const client = new OAuth2Client(
        creds.clientId,
        creds.clientSecret,
        `http://127.0.0.1:${port}`
      )
      client
        .getToken(code as string)
        .then(({ tokens }) => {
          const email = emailFromIdToken(tokens.id_token)
          saveAuth({ tokens, email })
          respond('Connected to Gmail ✓')
          finish(null, { connected: true, email })
        })
        .catch((e: unknown) => {
          respond('Login failed.')
          finish(e instanceof Error ? e : new Error('Token exchange failed.'))
        })
    })

    server.on('error', (e) => finish(e))

    // Listen on an ephemeral loopback port, then open the consent screen.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const client = new OAuth2Client(
        creds.clientId,
        creds.clientSecret,
        `http://127.0.0.1:${port}`
      )
      const authUrl = client.generateAuthUrl({
        access_type: 'offline', // request a refresh token
        prompt: 'consent', // force refresh_token even on re-auth
        scope: OAUTH_SCOPES,
        state: expectedState
      })
      shell.openExternal(authUrl).catch((e) => finish(e))
    })
  })
}

/**
 * Returns an OAuth2Client preloaded with stored credentials, ready for Gmail
 * API calls (RONY-7). Auto-persists tokens when the library refreshes them.
 * Returns null if the user isn't connected.
 */
export function getAuthorizedClient(): OAuth2Client | null {
  const creds = getOAuthCredentials()
  const stored = loadAuth()
  if (!creds || !stored?.tokens) return null

  const client = new OAuth2Client(creds.clientId, creds.clientSecret)
  client.setCredentials(stored.tokens)
  client.on('tokens', (tokens) => {
    // Merge refreshed tokens (a refresh response may omit refresh_token).
    saveAuth({ tokens: { ...stored.tokens, ...tokens }, email: stored.email })
  })
  return client
}
