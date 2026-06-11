import { describe, it, expect } from 'vitest'
import { buildAnthropicContent } from './anthropic'
import type { AiAttachment } from '../types'

const pdf: AiAttachment = {
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('hello pdf')
}
const img: AiAttachment = {
  filename: 'receipt.png',
  mimeType: 'image/png',
  data: Buffer.from('img')
}

describe('buildAnthropicContent', () => {
  it('returns just the text block when there are no attachments', () => {
    expect(buildAnthropicContent('classify this')).toEqual([
      { type: 'text', text: 'classify this' }
    ])
  })

  it('appends an image as a base64 image block', () => {
    const blocks = buildAnthropicContent('prompt', [img])
    expect(blocks[0]).toEqual({ type: 'text', text: 'prompt' })
    expect(blocks[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from('img').toString('base64')
      }
    })
  })

  it('appends a PDF as a base64 document block', () => {
    const blocks = buildAnthropicContent('prompt', [pdf])
    expect(blocks[1]).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from('hello pdf').toString('base64')
      }
    })
  })

  it('preserves order: text first, then each attachment', () => {
    const blocks = buildAnthropicContent('p', [pdf, img])
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[1].type).toBe('document') // pdf
    expect(blocks[2].type).toBe('image') // png
  })
})
