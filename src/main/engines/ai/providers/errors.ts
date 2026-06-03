/**
 * RONY-10/16 — Pull a concise message out of an OpenAI/Gemini JSON error body,
 * so failures read as "API key not valid…" instead of a raw JSON blob.
 */
export function extractApiError(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: string } })?.error?.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch {
    // body wasn't JSON — fall through to the raw (truncated) text
  }
  return body.slice(0, 200)
}
