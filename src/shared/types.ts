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

/** User-configurable settings (RONY-12). */
export interface Settings {
  /** Which engine runs by default when the user hits "Scan now". */
  defaultEngine: EngineType
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
  /** Simple connectivity check — returns 'pong'. Used by the RONY-4 DoD button. */
  ping: () => Promise<string>
  invoices: {
    /** Return all invoices, newest first. */
    list: () => Promise<Invoice[]>
    /** Return the total invoice count. */
    count: () => Promise<number>
    /** Insert a row and return it — used to demonstrate the DB write/read round-trip. */
    addSample: () => Promise<Invoice>
    /**
     * Open a downloaded invoice file with the OS default app (RONY-13 "Open
     * file" button). Takes the invoice's ID — NOT a path: the main process
     * looks up the file path in SQLite and validates it before opening, so the
     * untrusted renderer can never ask the OS to open an arbitrary path.
     * Resolves with an empty string on success, or an error message otherwise.
     */
    openFile: (invoiceId: number) => Promise<string>
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
  /** Persisted user settings (RONY-12). */
  settings: {
    get: () => Promise<Settings>
    set: (patch: Partial<Settings>) => Promise<Settings>
  }
  /** Gmail sync + scan pipeline (RONY-7/9/10/11, triggered by RONY-14). */
  scan: {
    /** Run a full scan in the background; resolves with a summary. */
    run: () => Promise<ScanResult>
  }
  /** Native OS dialogs (RONY-15). */
  dialog: {
    /** Open a "save as" dialog and write `content`; returns the path, or null if cancelled. */
    saveFile: (req: SaveFileRequest) => Promise<string | null>
  }
}
