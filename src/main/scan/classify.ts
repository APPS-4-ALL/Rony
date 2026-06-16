/**
 * RONY-14 — Scan engine dispatch (pure, dependency-injected).
 *
 * Given the emails RONY-7 fetched and the user's chosen engine, decide which
 * are invoices and produce the `ApprovedEmail[]` the downloader (RONY-11)
 * consumes. The two engines are injected, so this is fully unit-testable with
 * no network/Electron:
 *   - deterministic (RONY-9): keyword match, no extracted metadata.
 *   - ai (RONY-10): LLM classify + extract vendor/amount/currency/date, which
 *     flow through to the saved invoice row.
 */
import type { ParsedEmail } from '../gmail/parse'
import type { AiResult } from '../engines/ai/types'
import type { ApprovedEmail } from '../download/core'
import type { EngineType } from '../../shared/types'
import { logger, maskId } from '../lib/log'

export interface Classifiers {
  /** RONY-9: true when the email looks like an invoice/receipt. */
  deterministic: (email: ParsedEmail) => boolean
  /** RONY-10: classify + extract fields (may reject via `isFinancial: false`). */
  ai: (email: ParsedEmail) => Promise<AiResult>
}

export interface ClassifyOutcome {
  approved: ApprovedEmail[]
  /** Per-email classification failures (AI call errors). Non-fatal. */
  errors: number
  /** A representative error message (the first failure), for the UI. */
  firstError?: string
}

/** How many AI classifications to run at once (LLM calls are slow + rate-limited). */
const AI_CONCURRENCY = 4

/** Live classification progress: emails processed so far, total, and running matched count. */
export type ClassifyProgress = (processed: number, total: number, matched: number) => void

/**
 * Select the invoice emails using the chosen engine. Deterministic runs inline
 * (synchronous + free); AI runs with bounded concurrency and tolerates
 * per-email failures (one bad call doesn't abort the scan). `onProgress` (if
 * given) is called once per email so the UI can show "X of Y".
 */
export async function selectApproved(
  emails: ParsedEmail[],
  engine: EngineType,
  classifiers: Classifiers,
  onProgress?: ClassifyProgress,
  signal?: AbortSignal
): Promise<ClassifyOutcome> {
  if (engine === 'ai') return selectWithAi(emails, classifiers.ai, onProgress, signal)

  const approved: ApprovedEmail[] = []
  let processed = 0
  for (const email of emails) {
    if (signal?.aborted) break // user cancelled — stop classifying further emails
    if (classifiers.deterministic(email)) approved.push({ email, engineType: 'deterministic' })
    onProgress?.(++processed, emails.length, approved.length)
  }
  return { approved, errors: 0 }
}

async function selectWithAi(
  emails: ParsedEmail[],
  ai: (email: ParsedEmail) => Promise<AiResult>,
  onProgress?: ClassifyProgress,
  signal?: AbortSignal
): Promise<ClassifyOutcome> {
  const approved: ApprovedEmail[] = []
  let errors = 0
  let next = 0
  let processed = 0
  let firstError: string | undefined

  const worker = async (): Promise<void> => {
    // Stop pulling new emails once cancelled; in-flight AI calls finish.
    while (next < emails.length && !signal?.aborted) {
      const email = emails[next++]
      try {
        const result = await ai(email)
        if (result.isFinancial) {
          approved.push({
            email,
            engineType: 'ai',
            extracted: {
              vendor: result.vendor,
              amount: result.amount,
              currency: result.currency,
              date: result.date
            }
          })
        }
      } catch (e) {
        errors++
        if (!firstError) firstError = e instanceof Error ? e.message : String(e)
        logger.error(`[scan] AI classification failed for ${maskId(email.id)}:`, e)
      }
      onProgress?.(++processed, emails.length, approved.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, emails.length) }, worker))
  return { approved, errors, firstError }
}
