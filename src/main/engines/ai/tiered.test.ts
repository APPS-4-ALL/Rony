import { describe, it, expect, vi } from 'vitest'
import { classifyTiered, shouldEscalate } from './index'
import type { AiAttachment, AiResult, ProviderComplete } from './types'

function result(over: Partial<AiResult> = {}): AiResult {
  return {
    isFinancial: true,
    confidenceScore: 0.9,
    vendor: 'Acme',
    amount: 100,
    currency: 'ILS',
    date: '2026-05-01',
    ...over
  }
}

const PDF: AiAttachment = {
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('bytes')
}

describe('shouldEscalate', () => {
  it('escalates when the model asks for the document', () => {
    expect(shouldEscalate(result({ needsDocument: true }))).toBe(true)
  })

  it('escalates when a financial email has no amount', () => {
    expect(shouldEscalate(result({ isFinancial: true, amount: null }))).toBe(true)
  })

  it('does NOT escalate when the fast pass already has the amount', () => {
    expect(shouldEscalate(result({ isFinancial: true, amount: 100 }))).toBe(false)
  })

  it('does NOT escalate a non-financial email with no amount', () => {
    expect(shouldEscalate(result({ isFinancial: false, amount: null }))).toBe(false)
  })
})

/** A fake provider that returns the queued JSON strings in order, recording cfg. */
function fakeComplete(jsons: string[]): {
  complete: ProviderComplete
  calls: Array<{ model: string; hasAttachments: boolean }>
} {
  const calls: Array<{ model: string; hasAttachments: boolean }> = []
  let i = 0
  const complete: ProviderComplete = vi.fn(async ({ cfg, attachments }) => {
    calls.push({ model: cfg.model, hasAttachments: (attachments?.length ?? 0) > 0 })
    return jsons[i++]
  })
  return { complete, calls }
}

const base = {
  system: 'sys',
  user: 'usr',
  apiKey: 'k',
  fastModel: 'fast-1',
  strongModel: 'strong-1'
}

describe('classifyTiered', () => {
  it('uses only the fast model (text-only) when the fast pass is sufficient', async () => {
    const { complete, calls } = fakeComplete([
      JSON.stringify({ isFinancial: true, amount: 100, currency: 'ILS' })
    ])
    const loadAttachments = vi.fn()

    const out = await classifyTiered({ ...base, complete, loadAttachments })

    expect(out.amount).toBe(100)
    expect(calls).toEqual([{ model: 'fast-1', hasAttachments: false }])
    expect(loadAttachments).not.toHaveBeenCalled() // never fetched the document
  })

  it('escalates to the strong model WITH the document when the amount is missing', async () => {
    const { complete, calls } = fakeComplete([
      JSON.stringify({ isFinancial: true, amount: null }), // fast: no amount in text
      JSON.stringify({ isFinancial: true, amount: 1200, currency: 'ILS' }) // strong: read it
    ])
    const loadAttachments = vi.fn(async () => [PDF])

    const out = await classifyTiered({ ...base, complete, loadAttachments })

    expect(out.amount).toBe(1200)
    expect(loadAttachments).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      { model: 'fast-1', hasAttachments: false },
      { model: 'strong-1', hasAttachments: true }
    ])
  })

  it('escalates when the model sets needsDocument even if it found an amount', async () => {
    const { complete, calls } = fakeComplete([
      JSON.stringify({ isFinancial: true, amount: 5, needsDocument: true }),
      JSON.stringify({ isFinancial: true, amount: 980 })
    ])
    const out = await classifyTiered({ ...base, complete, loadAttachments: async () => [PDF] })

    expect(out.amount).toBe(980)
    expect(calls[1]).toEqual({ model: 'strong-1', hasAttachments: true })
  })

  it('keeps the fast result when escalation is wanted but no document is available', async () => {
    const { complete, calls } = fakeComplete([JSON.stringify({ isFinancial: true, amount: null })])
    const out = await classifyTiered({ ...base, complete, loadAttachments: async () => undefined })

    expect(out.amount).toBeNull()
    expect(calls).toHaveLength(1) // strong model never called
  })
})
