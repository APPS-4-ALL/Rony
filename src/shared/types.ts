/**
 * Shared types used across the main process, preload bridge, and renderer.
 * Keep this framework-agnostic — it is imported by both Node (main) and the browser (renderer).
 */

/** Which scanning engine catalogued an invoice. */
export type EngineType = 'deterministic' | 'ai'

/** Processing status of a located invoice/receipt. */
export type InvoiceStatus = 'pending' | 'downloaded' | 'exported' | 'error'

/** A located invoice/receipt and its extracted metadata. */
export interface Invoice {
  id: number
  /** Gmail message id this invoice originated from (nullable for manual/test rows). */
  messageId: string | null
  /** Invoice/receipt date as ISO-8601 string (YYYY-MM-DD), if known. */
  date: string | null
  vendor: string | null
  /** Amount in the document's currency, stored as a number. */
  amount: number | null
  currency: string | null
  /** Absolute path to the downloaded file on the local machine. */
  localFilePath: string | null
  status: InvoiceStatus
  engineType: EngineType
  /** Row creation timestamp (ISO-8601). */
  createdAt: string
}

/** Fields accepted when inserting a new invoice (id/createdAt are generated). */
export type NewInvoice = Omit<Invoice, 'id' | 'createdAt'>

/**
 * The typed API surface exposed to the renderer via the preload contextBridge.
 * Every method is asynchronous (it crosses the IPC boundary into the main process).
 */
export interface RoniApi {
  /** Simple connectivity check — returns 'pong'. Used by the RONY-4 DoD button. */
  ping: () => Promise<string>
  invoices: {
    /** Return all invoices, newest first. */
    list: () => Promise<Invoice[]>
    /** Return the total invoice count. */
    count: () => Promise<number>
    /** Insert a row and return it — used to demonstrate the DB write/read round-trip. */
    addSample: () => Promise<Invoice>
  }
}
