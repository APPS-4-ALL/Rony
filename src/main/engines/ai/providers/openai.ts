/**
 * RONY-10 — OpenAI provider adapter.
 *
 * Uses the Chat Completions API in JSON mode (`response_format json_object`)
 * so the model returns a parseable JSON object. Raw `fetch`, no SDK. Structural
 * + semantic validation is handled centrally by the engine's normalizer.
 */
import type { ProviderComplete } from '../types'
import { extractApiError } from './errors'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export const completeOpenAI: ProviderComplete = async ({ system, user, cfg }) => {
  const res = await fetch(OPENAI_URL, {
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
    throw new Error(`OpenAI API error ${res.status}: ${extractApiError(detail)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('OpenAI: response contained no message content.')
  }
  return content
}
