/**
 * RONY-10 — Resilient transport for the AI providers.
 *
 * The provider adapters (openai.ts, gemini.ts) used a bare `fetch()` with no
 * timeout and no retry: a hung connection stalled a classify slot indefinitely,
 * and a transient 429/5xx silently dropped that email. This wraps `fetch` with:
 *   - a per-attempt timeout via AbortController (no infinite hangs), and
 *   - bounded exponential back-off on transient HTTP statuses (429/5xx) AND on
 *     network/timeout errors, reusing the SAME policy as the Gmail layer.
 *
 * Non-transient responses (e.g. 400/401) are returned as-is so the caller can
 * surface the real provider error. The retry policy is imported from
 * `src/shared/http/retry.ts` so Gmail and AI stay in lock-step.
 */
import { backoffMs, isTransientStatus } from '../../../../shared/http/retry'

/** Default per-attempt timeout for an AI provider call. */
export const AI_TIMEOUT_MS = 30_000
/** Default number of RETRIES (so total attempts = retries + 1). */
export const AI_MAX_RETRIES = 3

export interface RetryFetchOptions {
  /** Abort a single attempt after this many ms (default {@link AI_TIMEOUT_MS}). */
  timeoutMs?: number
  /** Max retries after the first attempt (default {@link AI_MAX_RETRIES}). */
  maxRetries?: number
  /** Injectable `fetch` (defaults to the global) — lets tests drive it offline. */
  fetchImpl?: typeof fetch
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Was this thrown by our AbortController firing (i.e. a timeout)? */
function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))
}

/**
 * `fetch` with a timeout and bounded retry/back-off. Retries transient HTTP
 * statuses (429/5xx) and transient transport failures (timeout, network reset);
 * returns the final `Response` (which the caller still checks via `res.ok`).
 * Throws a readable error only when every attempt failed at the transport level.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryFetchOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS
  const maxRetries = opts.maxRetries ?? AI_MAX_RETRIES
  const doFetch = opts.fetchImpl ?? fetch

  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal })
      // Retry transient statuses with back-off; otherwise hand the response back.
      if (isTransientStatus(res.status) && attempt < maxRetries) {
        // Drain the body so the socket can be reused before we retry.
        await res.body?.cancel().catch(() => undefined)
        await delay(backoffMs(attempt))
        continue
      }
      return res
    } catch (e) {
      lastError = e
      // Timeouts and network errors are retryable; back off and try again.
      if (attempt < maxRetries) {
        await delay(backoffMs(attempt))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }

  if (isAbortError(lastError)) {
    throw new Error(`request timed out after ${timeoutMs}ms (${maxRetries + 1} attempts)`)
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`request failed after ${maxRetries + 1} attempts`)
}
