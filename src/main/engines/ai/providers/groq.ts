/**
 * Groq provider adapter.
 *
 * Groq serves open models (Llama, etc.) behind an OpenAI-COMPATIBLE Chat
 * Completions API (https://api.groq.com/openai/v1/chat/completions), so the
 * request/response shape mirrors the OpenAI text path. Groq's draw is speed and
 * low cost — it's a great FAST text classifier.
 *
 * TEXT-ONLY on purpose: Groq's open models don't reliably read PDFs/images
 * (vision support is preview-only and churns), so we never send attachments
 * here. The document-reading (vision) pass is best served by OpenAI / Gemini /
 * Claude — pick one of those when an invoice's total lives only inside the file.
 */
import type { ProviderComplete } from '../types'
import { extractApiError } from './errors'
import { fetchWithRetry } from './http'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export const completeGroq: ProviderComplete = async ({ system, user, cfg }) => {
  const res = await fetchWithRetry(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0, // deterministic extraction
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Groq API error ${res.status}: ${extractApiError(detail)}`)
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('Groq: response contained no message content.')
  }
  return content
}
