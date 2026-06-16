/**
 * RONY-20 — Install-ping policy (pure, no Electron/DB/network imports).
 *
 * Kept separate from the IO layer so the "should we send the ping?" decision is
 * unit-testable in isolation. The rule is deliberately strict (privacy-first):
 * we ping at most once per install, and ONLY when the user has opted in and a
 * server secret is configured.
 */
export interface PingState {
  /** The user's `installConsent` setting — the Hebrew opt-in toggle. */
  consent: boolean
  /** Whether a `RONY_API_SECRET` is configured (empty = tracking disabled). */
  hasSecret: boolean
  /** Whether this install was already counted (the persisted `install_pinged` flag). */
  alreadyPinged: boolean
}

/**
 * Decide whether to send the one-time install ping. True only when the user
 * consented, a secret exists, and we haven't already succeeded — so a declined
 * toggle, an unconfigured backend, or an already-counted install all stay silent.
 */
export function shouldPing(state: PingState): boolean {
  return state.consent && state.hasSecret && !state.alreadyPinged
}
