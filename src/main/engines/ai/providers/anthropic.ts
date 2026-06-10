/**
 * Anthropic (Claude) provider adapter.
 *
 * Raw HTTPS to the Messages API (https://api.anthropic.com/v1/messages),
 * matching the other providers (no SDK — keeps the main bundle light and the
 * code uniform). The system prompt goes in the top-level `system` field; the
 * email + any attachments go in a single user message. Vision: images become a
 * base64 `image` block and PDFs a base64 `document` block, so Claude can read
 * the total off the document itself. Output is the model's text, validated by
 * the engine's central normalizer.
 *
 * Notes for current Claude models (4.x): `temperature`/`top_p` are removed (they
 * 400 if sent) and adaptive thinking is OFF unless requested — so we send
 * neither and get the JSON answer directly. Claude may add prose around the
 * JSON; the central normalizer strips fences / extracts the object.
 */
import type { AiAttachment, ProviderComplete } from '../types'
import { extractApiError } from './errors'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
/** The JSON verdict is tiny; this is plenty and bounds cost. */
const MAX_TOKENS = 1024

/** A content block of a Claude user turn. */
type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * Build the user message content: the prompt text first, then each attachment as
 * an `image` (image/*) or `document` (PDF) block. Exported for unit testing.
 */
export function buildAnthropicContent(
  user: string,
  attachments?: AiAttachment[]
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [{ type: 'text', text: user }]
  for (const att of attachments ?? []) {
    const data = att.data.toString('base64')
    if (att.mimeType.toLowerCase().startsWith('image/')) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data } })
    } else {
      // Non-images reaching the vision pass are PDFs (the picker only sends
      // PDF/image), which Claude reads via a `document` block.
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data }
      })
    }
  }
  return blocks
}

export const completeClaude: ProviderComplete = async ({ system, user, cfg, attachments }) => {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: buildAnthropicContent(user, attachments) }]
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Claude API error ${res.status}: ${extractApiError(detail)}`)
  }

  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  // Concatenate the text blocks (Claude may return several); ignore any others.
  const content = (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  if (!content) {
    throw new Error('Claude: response contained no text content.')
  }
  return content
}
