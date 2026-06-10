import { describe, expect, it } from 'vitest'
import { AuthExpiredError, isInvalidGrant } from './errors'

describe('isInvalidGrant', () => {
  it('detects the structured Gaxios invalid_grant response', () => {
    const err = {
      response: {
        data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
      }
    }
    expect(isInvalidGrant(err)).toBe(true)
  })

  it('detects invalid_grant carried only in the message text', () => {
    expect(isInvalidGrant(new Error('Request failed: invalid_grant'))).toBe(true)
  })

  it('returns false for other API errors', () => {
    expect(isInvalidGrant({ response: { data: { error: 'access_denied' } } })).toBe(false)
    expect(isInvalidGrant({ response: { status: 404 } })).toBe(false)
    expect(isInvalidGrant(new Error('network timeout'))).toBe(false)
  })

  it('returns false for non-object / empty inputs', () => {
    expect(isInvalidGrant(null)).toBe(false)
    expect(isInvalidGrant(undefined)).toBe(false)
    expect(isInvalidGrant('invalid_grant')).toBe(false) // a bare string isn't a recognised error shape
  })
})

describe('AuthExpiredError', () => {
  it('is an Error with a reconnect-prompting Hebrew message', () => {
    const err = new AuthExpiredError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('AuthExpiredError')
    expect(err.message).toContain('Gmail')
    expect(err.message).toContain('הגדרות')
  })
})
