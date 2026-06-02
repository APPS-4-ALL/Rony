/**
 * RONY-7 — Gmail fetch layer.
 *
 * Reads messages from the Gmail REST API using the authorized OAuth2 client
 * built in RONY-6. We call the API through `OAuth2Client.request()` (from
 * google-auth-library) rather than pulling in the full `googleapis` package:
 * the client transparently attaches the bearer token and refreshes it when it
 * expires — and our RONY-6 `getAuthorizedClient()` persists those refreshes.
 *
 * Responsibilities (RONY-7): list messages that carry a PDF or image attachment
 * (optionally within a date range), fetch each in full, and parse them into
 * `ParsedEmail`s. Downloading attachment bytes and writing to the DB is
 * intentionally NOT here — that is RONY-11.
 */
import type { OAuth2Client } from 'google-auth-library'
import { getAuthorizedClient } from '../auth'
import {
  buildSearchQuery,
  isPdfOrImage,
  parseMessage,
  type GmailMessage,
  type ParsedEmail
} from './parse'

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
   * Lower date bound, inclusive (ISO `YYYY-MM-DD`). With `before`, this is the
   * "date range" the RONY-7 DoD asks for.
   */
  after?: string
  /** Upper date bound, exclusive (ISO `YYYY-MM-DD`). */
  before?: string
  /**
   * Escape hatch: a raw Gmail query that fully overrides the built-in
   * PDF/image + date-range query. Leave unset for normal use.
   */
  query?: string
  /** Hard cap on how many messages to pull in one run. */
  maxResults?: number
}

/** Default look-back when the caller gives no `after`/`before` range. */
const DEFAULT_WINDOW = '1y'
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

interface AttachmentResponse {
  size?: number
  /** base64url-encoded attachment bytes. */
  data?: string
}

/**
 * Download one attachment's raw bytes via `users.messages.attachments.get`
 * (RONY-11). Returns a Buffer ready to write to disk.
 */
export async function fetchAttachmentData(
  client: OAuth2Client,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const { data } = await client.request<AttachmentResponse>({
    url: `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  })
  if (!data.data) throw new Error(`Gmail attachment ${attachmentId} returned no data.`)
  return Buffer.from(data.data, 'base64url')
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
 * Fetch and parse Gmail messages that carry a PDF or image attachment, within
 * an optional date range (RONY-7). Each returned email's `attachments` list is
 * narrowed to PDFs/images, and messages left with none are dropped — so the
 * caller only ever sees in-scope files. Throws `NotConnectedError` if no
 * account is connected; individual message failures are caught and counted (so
 * one bad message doesn't abort the whole scan).
 */
export async function fetchEmails(options: FetchOptions = {}): Promise<FetchResult> {
  const client = getAuthorizedClient()
  if (!client) throw new NotConnectedError()

  const query =
    options.query ??
    buildSearchQuery({
      after: options.after,
      before: options.before,
      defaultWindow: DEFAULT_WINDOW
    })
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

  // Keep only PDF/image attachments; drop any message left with none. The
  // Gmail query already filters by extension — this MIME-level pass is the
  // authoritative second check and trims mixed-attachment emails down to scope.
  const emails: ParsedEmail[] = []
  for (const email of parsed) {
    if (!email) continue
    const attachments = email.attachments.filter(isPdfOrImage)
    if (attachments.length === 0) continue
    emails.push({ ...email, attachments })
  }

  return { emails, errors }
}
