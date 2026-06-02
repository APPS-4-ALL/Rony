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
}

/** How many AI classifications to run at once (LLM calls are slow + rate-limited). */
const AI_CONCURRENCY = 4

/**
 * Select the invoice emails using the chosen engine. Deterministic runs inline
 * (synchronous + free); AI runs with bounded concurrency and tolerates
 * per-email failures (one bad call doesn't abort the scan).
 */
export async function selectApproved(
  emails: ParsedEmail[],
  engine: EngineType,
  classifiers: Classifiers
): Promise<ClassifyOutcome> {
  if (engine === 'ai') return selectWithAi(emails, classifiers.ai)

  const approved: ApprovedEmail[] = []
  for (const email of emails) {
    if (classifiers.deterministic(email)) approved.push({ email, engineType: 'deterministic' })
  }
  return { approved, errors: 0 }
}

async function selectWithAi(
  emails: ParsedEmail[],
  ai: (email: ParsedEmail) => Promise<AiResult>
): Promise<ClassifyOutcome> {
  const approved: ApprovedEmail[] = []
  let errors = 0
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < emails.length) {
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
        console.error(`[scan] AI classification failed for ${email.id}:`, e)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, emails.length) }, worker))
  return { approved, errors }
}
