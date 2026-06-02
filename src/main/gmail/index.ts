/**
 * RONY-7 — Gmail fetch layer.
 *
 * Reads messages from the Gmail REST API using the authorized OAuth2 client
 * built in RONY-6. We call the API through `OAuth2Client.request()` (from
 * google-auth-library) rather than pulling in the full `googleapis` package:
 * the client transparently attaches the bearer token and refreshes it when it
 * expires — and our RONY-6 `getAuthorizedClient()` persists those refreshes.
 *
 * Responsibilities (RONY-7): list candidate messages, fetch each in full, and
 * parse them into `ParsedEmail`s. Downloading attachment bytes and writing to
 * the DB is intentionally NOT here — that is RONY-11.
 */
import type { OAuth2Client } from 'google-auth-library'
import { getAuthorizedClient } from '../auth'
import { parseMessage, type GmailMessage, type ParsedEmail } from './parse'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Thrown when a fetch is attempted while the user isn't connected to Gmail. */
export class NotConnectedError extends Error {
  constructor() {
    super('Not connected to Gmail. Connect an account first (RONY-6).')
    this.name = 'NotConnectedError'
  }
}

export interface FetchOptions {
  /**
   * Gmail search query (same syntax as the Gmail search box). Defaults to
   * recent messages with attachments — the common shape of an invoice email —
   * to keep the volume bounded. The deterministic engine still has the final
   * say on what counts as an invoice.
   */
  query?: string
  /** Hard cap on how many messages to pull in one run. */
  maxResults?: number
}

const DEFAULT_QUERY = 'newer_than:1y has:attachment'
const DEFAULT_MAX_RESULTS = 50
/** How many message fetches to run at once (politeness + memory bound). */
const FETCH_CONCURRENCY = 5

interface MessageListResponse {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

/**
 * List message IDs matching `query`, following pagination until we have
 * `maxResults` ids or Gmail runs out of pages.
 */
export async function listMessageIds(
  client: OAuth2Client,
  query: string,
  maxResults: number
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  while (ids.length < maxResults) {
    const params = new URLSearchParams({ q: query })
    // Ask for only what we still need, but never more than Gmail's 500 page cap.
    params.set('maxResults', String(Math.min(500, maxResults - ids.length)))
    if (pageToken) params.set('pageToken', pageToken)

    const { data } = await client.request<MessageListResponse>({
      url: `${GMAIL_API}/messages?${params.toString()}`
    })

    for (const m of data.messages ?? []) ids.push(m.id)
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }

  return ids.slice(0, maxResults)
}

/** Fetch one message in full (headers + body parts + attachment metadata). */
export async function getMessage(client: OAuth2Client, id: string): Promise<GmailMessage> {
  const { data } = await client.request<GmailMessage>({
    url: `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`
  })
  return data
}

/** Result of a fetch run: the parsed emails plus a count of per-message failures. */
export interface FetchResult {
  emails: ParsedEmail[]
  /** Messages that failed to fetch/parse (non-fatal — the run still completes). */
  errors: number
}

/** Run `tasks` with a fixed concurrency, preserving input order in the output. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Fetch and parse recent Gmail messages. Throws `NotConnectedError` if no
 * account is connected; individual message failures are caught and counted
 * (so one bad message doesn't abort the whole scan).
 */
export async function fetchEmails(options: FetchOptions = {}): Promise<FetchResult> {
  const client = getAuthorizedClient()
  if (!client) throw new NotConnectedError()

  const query = options.query ?? DEFAULT_QUERY
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS

  const ids = await listMessageIds(client, query, maxResults)

  let errors = 0
  const parsed = await mapWithConcurrency(ids, FETCH_CONCURRENCY, async (id) => {
    try {
      return parseMessage(await getMessage(client, id))
    } catch (e) {
      errors++
      console.error(`[gmail] failed to fetch/parse message ${id}:`, e)
      return null
    }
  })

  return { emails: parsed.filter((e): e is ParsedEmail => e !== null), errors }
}
