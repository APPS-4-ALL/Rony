import { describe, it, expect } from 'vitest'
import { buildGeminiParts } from './gemini'
import type { AiAttachment } from '../types'

const pdf: AiAttachment = {
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('hello pdf')
}

describe('buildGeminiParts', () => {
  it('returns just the text part when there are no attachments', () => {
    expect(buildGeminiParts('classify this')).toEqual([{ text: 'classify this' }])
  })

  it('appends each attachment as base64 inlineData after the text', () => {
    const parts = buildGeminiParts('prompt', [pdf])
    expect(parts[0]).toEqual({ text: 'prompt' })
    expect(parts[1]).toEqual({
      inlineData: { mimeType: 'application/pdf', data: Buffer.from('hello pdf').toString('base64') }
    })
  })

  it('preserves order: text first, then attachments', () => {
    const img: AiAttachment = {
      filename: 'r.png',
      mimeType: 'image/png',
      data: Buffer.from('img')
    }
    const parts = buildGeminiParts('p', [pdf, img])
    expect(parts).toHaveLength(3)
    expect('text' in parts[0]).toBe(true)
    expect('inlineData' in parts[1]).toBe(true)
    expect('inlineData' in parts[2]).toBe(true)
  })
})
