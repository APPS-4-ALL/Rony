/**
 * Shared retry policy for outbound HTTP calls (pure, dependency-free —
 * unit-testable). Lives in `src/shared` so BOTH the Gmail layer (which retries
 * via google-auth-library's `client.request`) and the AI providers (which retry
 * raw `fetch`) use ONE definition of "what is transient" and "how long to wait".
 *
 * ⚠️ Keep this file free of Node / Electron / Vue imports — it must run anywhere.
 */

/** Whether an HTTP status warrants a retry: 429 rate-limit or any 5xx server error. */
export function isTransientStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500)
}

/** Exponential back-off in ms for a given (0-based) retry attempt: capped + jittered. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250)
}
