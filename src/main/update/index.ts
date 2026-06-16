/**
 * RONY-20 — In-app auto-update (production only).
 *
 * Installed copies of Rony check GitHub Releases on startup, download a newer
 * version in the background, and install it on the next quit. The release
 * channel is the `publish: github` block in `electron-builder.yml`; in a
 * packaged build electron-builder bakes that into `app-update.yml`, so this
 * module needs no URL of its own.
 *
 * Design rules:
 *   - **Never block or crash the app.** A failed check (offline, GitHub down,
 *     rate-limited) is logged and swallowed — the user keeps working.
 *   - **Production only.** In dev there is no packaged updater target, so the
 *     caller guards on `!is.dev` and we never touch the network during `npm run
 *     dev`.
 *   - **Quiet.** We use electron-updater's notify-and-install-on-quit flow
 *     rather than nagging mid-session; logging goes through the PII-aware logger.
 */
import { autoUpdater } from 'electron-updater'
import { logger } from '../lib/log'

let started = false

/**
 * Wire the auto-updater and kick off a one-shot check. Safe to call once from
 * `app.whenReady()`. Subsequent calls are ignored so we never register the
 * event handlers (or check) twice.
 */
export function initAutoUpdate(): void {
  if (started) return
  started = true

  // Download silently in the background; the user is notified and the update is
  // applied on the next app quit. No forced restart mid-session.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => logger.info('[update] checking for updates'))
  autoUpdater.on('update-available', (info) =>
    logger.info(`[update] update available: ${info.version}`)
  )
  autoUpdater.on('update-not-available', () => logger.info('[update] up to date'))
  autoUpdater.on('update-downloaded', (info) =>
    logger.info(`[update] downloaded ${info.version} — will install on quit`)
  )
  // An update error must never surface as an uncaught exception; log and move on.
  autoUpdater.on('error', (err) => logger.warn('[update] updater error:', err))

  // `checkForUpdatesAndNotify` shows a native OS notification when an update is
  // found. It returns a promise that rejects on network failure — swallow it so
  // a missing connection at launch is a no-op, not an unhandled rejection.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    logger.warn('[update] initial check failed:', err)
  })
}
