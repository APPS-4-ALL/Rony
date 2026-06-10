import { describe, it, expect, vi } from 'vitest'
import { selectApproved, type Classifiers } from './classify'
import type { ParsedEmail } from '../gmail/parse'
import type { AiResult } from '../engines/ai/types'

function email(over: Partial<ParsedEmail>): ParsedEmail {
  return {
    id: 'm1',
    threadId: null,
    subject: 'Invoice',
    from: 'a@b.com',
    date: '2026-05-01',
    snippet: '',
    bodyText: 'body',
    attachments: [],
    links: [],
    ...over
  }
}

function aiResult(over: Partial<AiResult>): AiResult {
  return {
    isFinancial: true,
    confidenceScore: 0.9,
    vendor: 'Vendor Co',
    amount: 100,
    currency: 'ILS',
    date: '2026-05-01',
    ...over
  }
}

describe('selectApproved — deterministic engine', () => {
  const classifiers: Classifiers = {
    deterministic: (e) => e.subject.toLowerCase().includes('invoice'),
    ai: vi.fn() // must not be called
  }

  it('approves only matching emails, tagged deterministic, with no extracted data', async () => {
    const emails = [
      email({ id: 'a', subject: 'Your Invoice' }),
      email({ id: 'b', subject: 'Lunch?' })
    ]
    const out = await selectApproved(emails, 'deterministic', classifiers)

    expect(out.errors).toBe(0)
    expect(out.approved).toEqual([{ email: emails[0], engineType: 'deterministic' }])
    expect(classifiers.ai).not.toHaveBeenCalled()
  })
})

describe('selectApproved — AI engine', () => {
  it('approves financial emails and carries the extracted fields onto the row', async () => {
    const classifiers: Classifiers = {
      deterministic: () => false,
      ai: async (e) =>
        e.id === 'inv'
          ? aiResult({ vendor: 'Acme', amount: 540.5, currency: 'USD', date: '2026-03-03' })
          : aiResult({ isFinancial: false, vendor: null, amount: null, currency: null, date: null })
    }
    const emails = [email({ id: 'inv' }), email({ id: 'spam' })]

    const out = await selectApproved(emails, 'ai', classifiers)

    expect(out.errors).toBe(0)
    expect(out.approved).toEqual([
      {
        email: emails[0],
        engineType: 'ai',
        extracted: { vendor: 'Acme', amount: 540.5, currency: 'USD', date: '2026-03-03' }
      }
    ])
  })

  it('counts a failed AI call as an error and keeps going', async () => {
    const classifiers: Classifiers = {
      deterministic: () => false,
      ai: async (e) => {
        if (e.id === 'boom') throw new Error('rate limited')
        return aiResult({})
      }
    }
    const emails = [email({ id: 'boom' }), email({ id: 'ok' })]

    const out = await selectApproved(emails, 'ai', classifiers)

    expect(out.errors).toBe(1)
    expect(out.approved.map((a) => a.email.id)).toEqual(['ok'])
  })

  it('classifies every email even when there are more than the concurrency limit', async () => {
    const seen: string[] = []
    const classifiers: Classifiers = {
      deterministic: () => false,
      ai: async (e) => {
        seen.push(e.id)
        return aiResult({})
      }
    }
    const emails = Array.from({ length: 10 }, (_, i) => email({ id: `e${i}` }))

    const out = await selectApproved(emails, 'ai', classifiers)

    expect(seen).toHaveLength(10)
    expect(out.approved).toHaveLength(10)
  })
})
