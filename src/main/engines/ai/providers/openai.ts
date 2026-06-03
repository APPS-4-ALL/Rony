/**
 * RONY-10 — OpenAI provider adapter.
 *
 * Two paths, one return shape (raw JSON text, validated centrally):
 *  - TEXT-ONLY → Chat Completions in JSON mode (`response_format json_object`).
 *    Unchanged, proven path for the common case.
 *  - WITH ATTACHMENTS → the Responses API, which (unlike Chat Completions) can
 *    read PDFs via `input_file` and images via `input_image`, so the model can
 *    extract the amount from the document itself.
 */
import type { AiAttachment, ProviderComplete } from '../types'
import { extractApiError } from './errors'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

/** A `data:` URL for inlining bytes into a request. */
function dataUrl(att: AiAttachment): string {
  return `data:${att.mimeType};base64,${att.data.toString('base64')}`
}

/** A single content part of a Responses API user turn. */
type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; filename: string; file_data: string }

/**
 * Build the Responses API user `content`: the prompt text first, then each
 * attachment as an image or a file by MIME type. Exported for unit testing.
 */
export function buildOpenAIContent(
  user: string,
  attachments: AiAttachment[]
): ResponsesContentPart[] {
  const parts: ResponsesContentPart[] = [{ type: 'input_text', text: user }]
  for (const att of attachments) {
    if (att.mimeType.toLowerCase().startsWith('image/')) {
      parts.push({ type: 'input_image', image_url: dataUrl(att) })
    } else {
      parts.push({ type: 'input_file', filename: att.filename, file_data: dataUrl(att) })
    }
  }
  return parts
}

/** Text-only classification via Chat Completions (the original path). */
async function completeChat(
  system: string,
  user: string,
  apiKey: string,
  model: string
): Promise<string> {
  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
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

/** Vision classification via the Responses API (reads PDFs + images). */
async function completeResponses(
  system: string,
  user: string,
  apiKey: string,
  model: string,
  attachments: AiAttachment[]
): Promise<string> {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      instructions: system,
      input: [{ role: 'user', content: buildOpenAIContent(user, attachments) }],
      // Responses API uses `text.format` (not `response_format`) for JSON mode.
      text: { format: { type: 'json_object' } }
    })
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`OpenAI API error ${res.status}: ${extractApiError(detail)}`)
  }

  const data = (await res.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  }
  // The model's JSON lives in the `output_text` parts of the message item(s).
  const content = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  if (!content) {
    throw new Error('OpenAI: response contained no message content.')
  }
  return content
}

export const completeOpenAI: ProviderComplete = async ({ system, user, cfg, attachments }) => {
  return attachments && attachments.length > 0
    ? completeResponses(system, user, cfg.apiKey, cfg.model, attachments)
    : completeChat(system, user, cfg.apiKey, cfg.model)
}
