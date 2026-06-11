import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Mock Electron's safeStorage with a reversible, inspectable cipher: encrypt
 * prefixes "ENC:" and returns a Buffer; decrypt strips it and rejects anything
 * that isn't our ciphertext (simulating an undecryptable/corrupt blob). */
const isEncryptionAvailable = vi.fn(() => true)
const encryptString = vi.fn((s: string) => Buffer.from(`ENC:${s}`, 'utf-8'))
const decryptString = vi.fn((b: Buffer) => {
  const s = b.toString('utf-8')
  if (!s.startsWith('ENC:')) throw new Error('cannot decrypt')
  return s.slice('ENC:'.length)
})

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => isEncryptionAvailable(),
    encryptString: (s: string) => encryptString(s),
    decryptString: (b: Buffer) => decryptString(b)
  }
}))

import {
  encryptText,
  decryptText,
  encryptAmount,
  decryptAmount,
  ensureEncryptedText,
  ensureEncryptedAmount
} from './fieldCrypto'

beforeEach(() => {
  isEncryptionAvailable.mockReturnValue(true)
  encryptString.mockClear()
  decryptString.mockClear()
})

describe('text field encryption', () => {
  it('round-trips through encrypt → decrypt', () => {
    const cipher = encryptText('Acme Industries בע״מ')
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(cipher).not.toBe('Acme Industries בע״מ') // not stored as plaintext
    expect(decryptText(cipher)).toBe('Acme Industries בע״מ')
  })

  it('treats null/undefined as null on both sides', () => {
    expect(encryptText(null)).toBeNull()
    expect(encryptText(undefined)).toBeNull()
    expect(decryptText(null)).toBeNull()
    expect(decryptText(undefined)).toBeNull()
  })

  it('passes legacy plaintext (a string) through decrypt unchanged', () => {
    expect(decryptText('old plaintext vendor')).toBe('old plaintext vendor')
    expect(decryptString).not.toHaveBeenCalled()
  })

  it('decrypts to null when the blob is unreadable (different user / corruption)', () => {
    expect(decryptText(Buffer.from('not our ciphertext'))).toBeNull()
  })

  it('falls back to plaintext when OS encryption is unavailable', () => {
    isEncryptionAvailable.mockReturnValue(false)
    const stored = encryptText('Vendor Ltd')
    expect(stored).toBe('Vendor Ltd') // plaintext fallback, not a Buffer
    expect(encryptString).not.toHaveBeenCalled()
    expect(decryptText(stored)).toBe('Vendor Ltd')
  })
})

describe('amount field encryption', () => {
  it('round-trips a numeric amount (incl. decimals)', () => {
    const cipher = encryptAmount(1234.56)
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(decryptAmount(cipher)).toBe(1234.56)
  })

  it('round-trips zero', () => {
    const cipher = encryptAmount(0)
    expect(Buffer.isBuffer(cipher)).toBe(true)
    expect(decryptAmount(cipher)).toBe(0)
  })

  it('treats null as null on both sides', () => {
    expect(encryptAmount(null)).toBeNull()
    expect(decryptAmount(null)).toBeNull()
  })

  it('passes a legacy numeric amount through decrypt unchanged', () => {
    expect(decryptAmount(99.5)).toBe(99.5)
    expect(decryptString).not.toHaveBeenCalled()
  })

  it('decrypts to null for an unreadable blob or non-numeric content', () => {
    expect(decryptAmount(Buffer.from('garbage'))).toBeNull()
    encryptString.mockReturnValueOnce(Buffer.from('ENC:not-a-number'))
    expect(decryptAmount(encryptAmount(123))).toBeNull()
  })

  it('falls back to plaintext when OS encryption is unavailable', () => {
    isEncryptionAvailable.mockReturnValue(false)
    const stored = encryptAmount(42)
    expect(stored).toBe(42)
    expect(decryptAmount(stored)).toBe(42)
  })
})

describe('idempotent re-encryption (migration helpers)', () => {
  it('encrypts legacy plaintext and re-encrypts ciphertext to the same value', () => {
    // Legacy plaintext → ciphertext.
    const fromPlain = ensureEncryptedText('Legacy Vendor')
    expect(Buffer.isBuffer(fromPlain)).toBe(true)
    expect(decryptText(fromPlain)).toBe('Legacy Vendor')

    // Already-ciphertext → still decrypts to the same plaintext (no double-wrap).
    const reEncrypted = ensureEncryptedText(fromPlain)
    expect(Buffer.isBuffer(reEncrypted)).toBe(true)
    expect(decryptText(reEncrypted)).toBe('Legacy Vendor')
  })

  it('encrypts a legacy numeric amount and re-encrypts ciphertext to the same value', () => {
    const fromNumber = ensureEncryptedAmount(250)
    expect(Buffer.isBuffer(fromNumber)).toBe(true)
    expect(decryptAmount(fromNumber)).toBe(250)

    const reEncrypted = ensureEncryptedAmount(fromNumber)
    expect(decryptAmount(reEncrypted)).toBe(250)
  })

  it('leaves nulls as null', () => {
    expect(ensureEncryptedText(null)).toBeNull()
    expect(ensureEncryptedAmount(null)).toBeNull()
  })
})
