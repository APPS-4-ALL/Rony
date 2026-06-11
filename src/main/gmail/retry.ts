/**
 * Retry policy for Gmail API calls.
 *
 * The implementation now lives in `src/shared/http/retry.ts` so the AI providers
 * can share the exact same transient-status + back-off policy. This module is
 * kept as a thin re-export so existing imports (and gmail/retry.test.ts) keep
 * working unchanged.
 */
export { backoffMs, isTransientStatus } from '../../shared/http/retry'
