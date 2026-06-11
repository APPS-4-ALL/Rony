/**
 * PII-aware logging helper (main process).
 *
 * Problem: `console.*` calls across the app log raw filenames
 * ("invoice_John_Doe.pdf"), message ids, full file paths, and provider error
 * bodies — financial/PII data the brief says must NOT appear in logs.
 *
 * This module is the single chokepoint for app logging:
 *   - free-text messages and Error messages are run through `redactPii` (the
 *     same masking used before sending text to an AI provider), so emails,
 *     phone/account/card/ID numbers never reach the log sink;
 *   - filenames are masked with {@link maskFile} (keep the extension, redact the
 *     stem) and ids with {@link maskId} (keep a short prefix) — call these when
 *     building a message;
 *   - `debug`/`info` are silenced in production builds (only `warn`/`error` ship),
 *     so verbose operational detail doesn't accumulate on users' machines.
 *
 * Usage:
 *   import { logger, maskFile, maskId } from '../lib/log'
 *   logger.error(`[download] failed for ${maskId(messageId)} / ${maskFile(name)}:`, err)
 */
import { redactPii } from '../engines/ai/redact'

type Level = 'debug' | 'info' | 'warn' | 'error'

/** In a packaged build there is no Vite dev-server URL; treat that as production. */
const isProduction = !process.env['ELECTRON_RENDERER_URL'] && process.env.NODE_ENV === 'production'

/**
 * Mask a filename for logs: keep the extension, reduce the stem to first+last
 * char. "invoice_acme_2026.pdf" → "i…6.pdf"; short/edge names → "***.ext".
 */
export function maskFile(name: string): string {
  if (!name) return '(none)'
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = slash >= 0 ? name.slice(slash + 1) : name
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot) : ''
  const stem = dot > 0 ? base.slice(0, dot) : base
  if (stem.length <= 2) return `***${ext}`
  return `${stem[0]}…${stem[stem.length - 1]}${ext}`
}

/** Mask an opaque id (Gmail message id, etc.): keep a short prefix only. */
export function maskId(id: string | null | undefined): string {
  if (!id) return '(none)'
  return id.length <= 6 ? '***' : `${id.slice(0, 6)}…`
}

/** Redact PII from an arbitrary log argument (strings + Error messages). */
function scrub(arg: unknown): unknown {
  if (typeof arg === 'string') return redactPii(arg)
  if (arg instanceof Error) {
    // Replace the message in place so stack frames (file paths) are kept but the
    // human-readable message is scrubbed.
    arg.message = redactPii(arg.message)
    return arg
  }
  return arg
}

function emit(level: Level, message: string, rest: unknown[]): void {
  if (isProduction && (level === 'debug' || level === 'info')) return
  const sink = level === 'debug' ? console.log : console[level]
  sink(redactPii(message), ...rest.map(scrub))
}

export const logger = {
  debug: (message: string, ...rest: unknown[]): void => emit('debug', message, rest),
  info: (message: string, ...rest: unknown[]): void => emit('info', message, rest),
  warn: (message: string, ...rest: unknown[]): void => emit('warn', message, rest),
  error: (message: string, ...rest: unknown[]): void => emit('error', message, rest)
}
