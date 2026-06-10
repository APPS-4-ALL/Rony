import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { classifyWithAI, normalizeAiResult } from './index'
import type { AiInput } from './types'

const SAMPLE: AiInput = {
  subject: 'חשבונית מס 1234',
  body: 'סכום לתשלום: 351.00 ש"ח, תאריך 01/05/2026',
  from: 'billing@vendor.co.il',
  filenames: ['invoice_1234.pdf']
}

/** Build a fake `fetch` Response. */
function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response
}

/** Stub global `fetch` with a typed mock and return it for call assertions. */
function mockFetch(
  body: unknown,
  ok = true,
  status = 200
): Mock<(url: unknown, init?: unknown) => Promise<Response>> {
  const fn = vi.fn<(url: unknown, init?: unknown) => Promise<Response>>(() =>
    Promise.resolve(fakeResponse(body, ok, status))
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

/** The structured object a model should emit (as a JSON string). */
const MODEL_JSON = JSON.stringify({
  reasoning: 'Subject is a tax invoice and the body states an amount due.',
  isFinancial: true,
  confidenceScore: 0.92,
  vendor: 'Vendor Co.',
  amount: 351.0,
  currency: 'ILS',
  date: '2026-05-01'
})

const openaiPayload = { choices: [{ message: { content: MODEL_JSON } }] }
const geminiPayload = { candidates: [{ content: { parts: [{ text: MODEL_JSON }] } }] }

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-openai-key'
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  delete process.env.AI_PROVIDER
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('classifyWithAI — DoD: structured JSON from the API', () => {
  it('returns a normalized AiResult from OpenAI for a sample email', async () => {
    const fetchMock = mockFetch(openaiPayload)

    const result = await classifyWithAI(SAMPLE, { provider: 'openai' })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.openai.com')
    expect(result).toEqual({
      isFinancial: true,
      confidenceScore: 0.92,
      reasoning: 'Subject is a tax invoice and the body states an amount due.',
      vendor: 'Vendor Co.',
      amount: 351.0,
      currency: 'ILS',
      date: '2026-05-01'
    })
  })

  it('returns a normalized AiResult from Gemini for a sample email', async () => {
    const fetchMock = mockFetch(geminiPayload)

    const result = await classifyWithAI(SAMPLE, { provider: 'gemini' })

    expect(String(fetchMock.mock.calls[0][0])).toContain('generativelanguage.googleapis.com')
    expect(result.isFinancial).toBe(true)
    expect(result.amount).toBe(351)
  })

  it('selects the provider from AI_PROVIDER when not passed explicitly', async () => {
    process.env.AI_PROVIDER = 'gemini'
    const fetchMock = mockFetch(geminiPayload)

    await classifyWithAI(SAMPLE)
    expect(String(fetchMock.mock.calls[0][0])).toContain('generativelanguage')
  })
})

describe('error handling', () => {
  it('throws a helpful error when the API key is missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(classifyWithAI(SAMPLE, { provider: 'openai' })).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('throws on a non-OK HTTP response', async () => {
    mockFetch({ error: 'bad' }, false, 401)
    await expect(classifyWithAI(SAMPLE, { provider: 'openai' })).rejects.toThrow(
      /OpenAI API error 401/
    )
  })

  it('rejects an unsupported AI_PROVIDER value', async () => {
    process.env.AI_PROVIDER = 'mistral' // openai/gemini/claude/groq are supported
    await expect(classifyWithAI(SAMPLE)).rejects.toThrow(/Unsupported AI_PROVIDER/)
  })
})

describe('explicit apiKey override (RONY-16)', () => {
  it('uses the passed-in key with no env key present', async () => {
    delete process.env.OPENAI_API_KEY // no env fallback available
    const fetchMock = mockFetch(openaiPayload)

    const result = await classifyWithAI(SAMPLE, {
      provider: 'openai',
      apiKey: 'sk-from-secure-store'
    })

    expect(result.isFinancial).toBe(true)
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe('Bearer sk-from-secure-store')
  })
})

describe('normalizeAiResult — robust parsing', () => {
  it('strips markdown code fences', () => {
    const r = normalizeAiResult('```json\n{"isFinancial":true,"confidenceScore":0.5}\n```')
    expect(r.isFinancial).toBe(true)
    expect(r.confidenceScore).toBe(0.5)
  })

  it('cleans a messy amount and never concatenates trailing text', () => {
    expect(normalizeAiResult('{"isFinancial":true,"amount":"₪1,234.50"}').amount).toBe(1234.5)
    // the corruption case Gemini flagged: trailing "(ID: 123)" must be ignored
    expect(normalizeAiResult('{"isFinancial":true,"amount":"1000.50 (ID: 123)"}').amount).toBe(
      1000.5
    )
    expect(normalizeAiResult('{"isFinancial":false,"amount":"n/a"}').amount).toBeNull()
  })

  it('accepts only strict, real YYYY-MM-DD dates', () => {
    expect(normalizeAiResult('{"isFinancial":true,"date":"2026-05-01"}').date).toBe('2026-05-01')
    expect(normalizeAiResult('{"isFinancial":true,"date":"01/05/2026"}').date).toBeNull()
    expect(normalizeAiResult('{"isFinancial":true,"date":"2026-13-45"}').date).toBeNull()
  })

  it('clamps confidence to [0,1] and defaults missing to 0', () => {
    expect(normalizeAiResult('{"isFinancial":true,"confidenceScore":1.7}').confidenceScore).toBe(1)
    expect(normalizeAiResult('{"isFinancial":true,"confidenceScore":-3}').confidenceScore).toBe(0)
    expect(normalizeAiResult('{"isFinancial":true}').confidenceScore).toBe(0)
  })

  it('omits reasoning when the model does not provide it', () => {
    expect('reasoning' in normalizeAiResult('{"isFinancial":true}')).toBe(false)
  })

  it('treats a non-financial result as all-null fields', () => {
    const r = normalizeAiResult('{"isFinancial":false,"vendor":"","amount":null,"date":null}')
    expect(r).toMatchObject({ isFinancial: false, vendor: null, amount: null, date: null })
  })

  it('throws when the output is not JSON at all', () => {
    expect(() => normalizeAiResult('I cannot help with that.')).toThrow(/non-JSON/)
  })
})
