import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchWithRetry } from './http'

/** A minimal Response stand-in good enough for fetchWithRetry. */
function fakeResponse(status: number): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: { cancel: () => Promise.resolve() }
  } as unknown as Response
}

describe('fetchWithRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns immediately on a 200 (no retry)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200))
    const res = await fetchWithRetry('https://x', {}, { fetchImpl })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries transient 429/5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(200))
    const p = fetchWithRetry('https://x', {}, { fetchImpl, maxRetries: 3 })
    await vi.runAllTimersAsync() // fast-forward the back-off sleeps
    const res = await p
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a non-transient 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(400))
    const res = await fetchWithRetry('https://x', {}, { fetchImpl, maxRetries: 3 })
    expect(res.status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries on a thrown transport error, then gives up with a readable message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const p = fetchWithRetry('https://x', {}, { fetchImpl, maxRetries: 2 })
    const assertion = expect(p).rejects.toThrow('ECONNRESET')
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 1 try + 2 retries
  })

  it('surfaces a timeout (AbortError) as a readable error', async () => {
    const fetchImpl = vi.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const p = fetchWithRetry('https://x', {}, { fetchImpl, timeoutMs: 1000, maxRetries: 0 })
    const assertion = expect(p).rejects.toThrow(/timed out after 1000ms/)
    await vi.runAllTimersAsync()
    await assertion
  })
})
