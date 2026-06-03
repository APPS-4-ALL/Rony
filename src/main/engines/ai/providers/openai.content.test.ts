import { describe, it, expect } from 'vitest'
import { buildOpenAIContent } from './openai'
import type { AiAttachment } from '../types'

const pdf: AiAttachment = {
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('pdf-bytes')
}
const img: AiAttachment = {
  filename: 'receipt.png',
  mimeType: 'image/png',
  data: Buffer.from('png-bytes')
}

describe('buildOpenAIContent', () => {
  it('starts with the prompt as an input_text part', () => {
    expect(buildOpenAIContent('classify', [])[0]).toEqual({
      type: 'input_text',
      text: 'classify'
    })
  })

  it('sends a PDF as an input_file with a data URL', () => {
    const parts = buildOpenAIContent('p', [pdf])
    expect(parts[1]).toEqual({
      type: 'input_file',
      filename: 'invoice.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from('pdf-bytes').toString('base64')}`
    })
  })

  it('sends an image as an input_image with a data URL', () => {
    const parts = buildOpenAIContent('p', [img])
    expect(parts[1]).toEqual({
      type: 'input_image',
      image_url: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`
    })
  })
})
