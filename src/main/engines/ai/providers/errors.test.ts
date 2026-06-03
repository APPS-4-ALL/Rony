import { describe, it, expect } from 'vitest'
import { extractApiError } from './errors'

describe('extractApiError', () => {
  it('extracts the message from a provider JSON error body', () => {
    const body = JSON.stringify({
      error: { code: 400, message: 'API key not valid. Please pass a valid API key.' }
    })
    expect(extractApiError(body)).toBe('API key not valid. Please pass a valid API key.')
  })

  it('falls back to truncated raw text when the body is not JSON', () => {
    expect(extractApiError('Bad Gateway')).toBe('Bad Gateway')
    expect(extractApiError('x'.repeat(500))).toHaveLength(200)
  })
})
