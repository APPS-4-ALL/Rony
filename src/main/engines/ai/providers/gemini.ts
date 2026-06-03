/**
 * RONY-10 — Gemini provider adapter.
 *
 * Uses `generateContent` in JSON mode (`responseMimeType: application/json`),
 * prompt-guided — deliberately WITHOUT a `responseSchema`, since schema-
 * constrained decoding made gemini-2.5-flash loop/garble on Hebrew input.
 * Raw `fetch`, no SDK; output is validated by the engine's central normalizer.
 */
import type { AiAttachment, ProviderComplete } from '../types'
import { extractApiError } from './errors'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** A single `parts[]` entry of a Gemini `user` content turn. */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/**
 * Build the user turn's `parts`: the text prompt first, then any attachments as
 * `inlineData` (base64). Gemini reads PDFs and images natively this way.
 * Exported for unit testing.
 */
export function buildGeminiParts(user: string, attachments?: AiAttachment[]): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: user }]
  for (const att of attachments ?? []) {
    parts.push({ inlineData: { mimeType: att.mimeType, data: att.data.toString('base64') } })
  }
  return parts
}

export const completeGemini: ProviderComplete = async ({ system, user, cfg, attachments }) => {
  const url = `${GEMINI_BASE}/${encodeURIComponent(cfg.model)}:generateContent`

  // "flash" models let us turn OFF thinking (thinkingBudget 0) to save the
  // output budget and avoid truncating the JSON. "pro" models REQUIRE thinking
  // mode — sending budget 0 there returns a 400 ("only works in thinking mode")
  // — so we leave thinking on and give the response more room.
  const canDisableThinking = /flash/i.test(cfg.model)
  const generationConfig: Record<string, unknown> = {
    // A small non-zero temperature avoids greedy-decoding repetition loops
    // that can leave a field's string unterminated.
    temperature: 0.2,
    // Room for the (small) JSON answer — and, on thinking models, the thoughts.
    maxOutputTokens: canDisableThinking ? 1024 : 8192,
    // JSON mode WITHOUT a responseSchema: schema-constrained decoding made
    // gemini-2.5-flash degenerate into repetition loops on Hebrew input.
    // The prompt already specifies the exact keys; we validate centrally.
    responseMimeType: 'application/json'
  }
  if (canDisableThinking) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key in a header (not the query string) so it doesn't land in logs/URLs.
      'x-goog-api-key': cfg.apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: buildGeminiParts(user, attachments) }],
      generationConfig
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini API error ${res.status}: ${extractApiError(detail)}`)
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
  }
  // Gemini may split the JSON across several parts and include internal
  // "thought" parts — concatenate the answer text, skipping thoughts.
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const content = parts
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  if (!content) {
    throw new Error('Gemini: response contained no text content.')
  }
  return content
}
