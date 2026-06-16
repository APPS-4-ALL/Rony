/**
 * RONY-20 — Anonymous install ping (opt-in install counter).
 *
 * When the user accepts the `installConsent` toggle, Rony reports a SINGLE
 * anonymous "this copy exists" ping to apps4all so installs can be counted on
 * the website panel. Modeled on the Tal desktop app's data connection
 * (see `docs/install-tracking.md`) but stripped to the privacy minimum:
 *   - NO invoice data, email, or personal info — only a random install id, the
 *     app version, and the OS platform.
 *   - Gated on explicit consent (off by default) AND a configured secret.
 *   - Fire-once: on success we set a local flag and never ping again. A failed
 *     attempt (offline / backend down) leaves the flag unset so the next launch
 *     retries — the install is never silently lost.
 *   - Fully failure-tolerant: a bad call is logged and swallowed, never thrown.
 */
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { config as loadDotenv } from 'dotenv'
import { getSetting, setSetting } from '../db'
import { getSettings } from '../settings'
import { logger } from '../lib/log'
import { shouldPing } from './policy'

// Mirror the RONY-6/10 env pattern: a gitignored `.env` in dev supplies the
// backend URL + secret. dotenv never overrides real env, so prod/test win.
loadDotenv({ quiet: true })

const KEY_INSTALL_ID = 'install_id'
const KEY_INSTALL_PINGED = 'install_pinged'

/** Default backend host (same site as the Tal example); the path lives in code. */
const DEFAULT_API_URL = 'https://apps4all.net'

/** Get the persisted anonymous install id, generating + storing one on first use. */
function getOrCreateInstallId(): string {
  const existing = getSetting(KEY_INSTALL_ID)
  if (existing) return existing
  const id = randomUUID()
  setSetting(KEY_INSTALL_ID, id)
  return id
}

/**
 * Send the one-time install ping IF the policy allows (consent on, secret set,
 * not yet counted). Safe to call on every startup and right after the consent
 * toggle flips on — it self-gates and only ever fires once per install.
 */
export async function maybePingInstall(): Promise<void> {
  const secret = (process.env.RONY_API_SECRET ?? '').trim()
  const alreadyPinged = getSetting(KEY_INSTALL_PINGED) === '1'
  const { installConsent } = getSettings()

  if (!shouldPing({ consent: installConsent, hasSecret: secret !== '', alreadyPinged })) return

  const baseUrl = (process.env.RONY_API_URL ?? DEFAULT_API_URL).trim().replace(/\/+$/, '')
  const installId = getOrCreateInstallId()

  try {
    const res = await fetch(`${baseUrl}/api/rony/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rony-secret': secret },
      body: JSON.stringify({
        install_id: installId,
        app_version: app.getVersion(),
        platform: process.platform
      }),
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) {
      // Mark counted only on confirmed success, so failures retry next launch.
      setSetting(KEY_INSTALL_PINGED, '1')
      logger.info('[install] registered anonymous install')
    } else {
      logger.warn(`[install] register rejected: HTTP ${res.status}`)
    }
  } catch (err) {
    // Offline / backend not deployed yet / timeout — non-fatal, retry later.
    logger.warn('[install] register failed (non-fatal):', err)
  }
}
