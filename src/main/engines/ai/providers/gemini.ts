/**
 * RONY-10 — Gemini provider adapter.
 *
 * Uses `generateContent` in JSON mode (`responseMimeType: application/json`),
 * prompt-guided — deliberately WITHOUT a `responseSchema`, since schema-
 * constrained decoding made gemini-2.5-flash loop/garble on Hebrew input.
 * Raw `fetch`, no SDK; output is validated by the engine's central normalizer.
 */
import type { ProviderComplete } from '../types'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const completeGemini: ProviderComplete = async ({ system, user, cfg }) => {
  const url = `${GEMINI_BASE}/${encodeURIComponent(cfg.model)}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key in a header (not the query string) so it doesn't land in logs/URLs.
      'x-goog-api-key': cfg.apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        // A small non-zero temperature avoids greedy-decoding repetition loops
        // that can leave a field's string unterminated.
        temperature: 0.2,
        // Disable "thinking" (Gemini 2.5+) — for this small classification it
        // only burns the output budget and can truncate the JSON mid-stream.
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1024,
        // JSON mode WITHOUT a responseSchema: schema-constrained decoding made
        // gemini-2.5-flash degenerate into repetition loops on Hebrew input.
        // The prompt already specifies the exact keys; we validate centrally.
        responseMimeType: 'application/json'
      }
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`)
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
