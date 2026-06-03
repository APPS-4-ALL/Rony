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

/* ------------------------------------------------------------------ *
 * Step-0 contract types — the shared "interface" both tracks build against.
 * Backend (Person A) implements the real handlers; frontend (Person B)
 * builds the views against these shapes. Change ONLY in a Step-0-style
 * joint commit, never simultaneously.
 * ------------------------------------------------------------------ */

/** Gmail connection state, surfaced to the Settings/Auth view (RONY-12). */
export interface AuthStatus {
  connected: boolean
  /** The signed-in Google account email, or null when disconnected. */
  email: string | null
}

/** Supported external LLM providers for the AI engine (RONY-10/16). */
export type AiProvider = 'openai' | 'gemini'

/** User-configurable settings (RONY-12, RONY-16). */
export interface Settings {
  /** Which engine runs by default when the user hits "Scan now". */
  defaultEngine: EngineType
  /** Which AI provider the AI engine uses when `defaultEngine` is 'ai' (RONY-16). */
  aiProvider: AiProvider
  /**
   * Optional custom folder to save downloaded invoice files into. `null` means
   * use the default (`Documents/Rony Invoices`).
   */
  downloadDir: string | null
}

/**
 * Per-run scan controls, chosen in the UI (max messages + optional date range).
 * All fields are optional — an omitted field falls back to the engine default
 * (50 messages, last 1 year).
 */
export interface ScanOptions {
  /** Hard cap on how many messages to pull in one run. */
  maxResults?: number
  /** Lower date bound, inclusive (ISO `YYYY-MM-DD`). */
  after?: string
  /** Upper date bound, exclusive (ISO `YYYY-MM-DD`). */
  before?: string
}

/** The phases a scan moves through, reported live via `scan.onProgress`. */
export type ScanPhase = 'fetching' | 'classifying' | 'downloading' | 'done'

/** Live progress for an in-flight scan (X of Y). */
export interface ScanProgress {
  phase: ScanPhase
  /** Items handled so far in the current phase. */
  processed: number
  /** Total items in the current phase (0 = indeterminate). */
  total: number
  /** Running count of emails classified as invoices/receipts. */
  matched: number
  /** Running count of files downloaded. */
  downloaded: number
}

/** Summary returned when a scan finishes (RONY-14 shows this on completion). */
export interface ScanResult {
  /** Emails inspected. */
  scanned: number
  /** Emails classified as invoices/receipts. */
  matched: number
  /** Attachments successfully downloaded + recorded in the DB. */
  downloaded: number
  /** Failures encountered (non-fatal). */
  errors: number
  /** A representative error message when `errors > 0` (e.g. "Gemini API error 400: API key not valid"). */
  errorSample?: string
}

/** Request payload for the native "save file" dialog (RONY-15 CSV export). */
export interface SaveFileRequest {
  /** Suggested file name shown in the OS dialog, e.g. "invoices-2026-06-01.csv". */
  defaultName: string
  /** The full file contents to write. */
  content: string
}

/**
 * The typed API surface exposed to the renderer via the preload contextBridge.
 * Every method is asynchronous (it crosses the IPC boundary into the main process).
 */
export interface RoniApi {
  invoices: {
    /** Return all invoices, newest first. */
    list: () => Promise<Invoice[]>
    /**
     * Open a downloaded invoice file with the OS default app (RONY-13 "Open
     * file" button). Takes the invoice's ID — NOT a path: the main process
     * looks up the file path in SQLite and validates it before opening, so the
     * untrusted renderer can never ask the OS to open an arbitrary path.
     * Resolves with an empty string on success, or an error message otherwise.
     */
    openFile: (invoiceId: number) => Promise<string>
    /**
     * Delete an invoice: removes its row from the DB and its downloaded file
     * from disk (only if that file lives inside our invoices folder). Takes the
     * invoice's ID. Resolves with an empty string on success, or an error message.
     */
    delete: (invoiceId: number) => Promise<string>
  }
  /** Google OAuth / Gmail connection (RONY-6, RONY-12). */
  auth: {
    /** Current connection status. */
    status: () => Promise<AuthStatus>
    /** Start the OAuth desktop flow; resolves with the resulting status. */
    login: () => Promise<AuthStatus>
    /** Sign out and clear stored tokens; resolves with the resulting status. */
    logout: () => Promise<AuthStatus>
  }
  /** Persisted user settings (RONY-12) + AI API-key management (RONY-16). */
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
    /**
     * Securely store the user's API key for a provider (encrypted at rest via
     * Electron safeStorage). The key is write-only from the renderer.
     */
    setApiKey: (provider: AiProvider, key: string) => Promise<void>
    /** Whether a key is stored for the provider. The key itself is never returned. */
    hasApiKey: (provider: AiProvider) => Promise<boolean>
    /** Remove the stored key for a provider. */
    clearApiKey: (provider: AiProvider) => Promise<void>
  }
  /** Gmail sync + scan pipeline (RONY-7/9/10/11, triggered by RONY-14). */
  scan: {
    /**
     * Run a full scan in the background; resolves with a summary. Optional
     * `opts` let the user cap the message count and/or restrict the date range
     * for this run; omitted fields use the engine defaults.
     */
    run: (opts?: ScanOptions) => Promise<ScanResult>
    /**
     * Subscribe to live scan progress. Returns an unsubscribe function — call it
     * (e.g. on unmount) to stop listening.
     */
    onProgress: (callback: (progress: ScanProgress) => void) => () => void
  }
  /** Native OS dialogs (RONY-15). */
  dialog: {
    /** Open a "save as" dialog and write `content`; returns the path, or null if cancelled. */
    saveFile: (req: SaveFileRequest) => Promise<string | null>
    /** Open a "choose folder" dialog; returns the selected folder path, or null if cancelled. */
    pickFolder: () => Promise<string | null>
  }
}
