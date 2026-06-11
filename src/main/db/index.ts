import { join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { Invoice, NewInvoice } from '../../shared/types'

let db: Database.Database | null = null

/**
 * Current schema version. Bump this whenever you add a migration step in
 * {@link runMigrations}. Tracked in SQLite's `PRAGMA user_version` so upgrades
 * run exactly once and in order, instead of re-probing the table shape ad hoc.
 */
const SCHEMA_VERSION = 1

/** Maps a raw DB row (snake_case columns) to the camelCase Invoice shape. */
interface InvoiceRow {
  id: number
  message_id: string | null
  date: string | null
  date_source: Invoice['dateSource']
  vendor: string | null
  amount: number | null
  currency: string | null
  local_file_path: string | null
  email_body: string | null
  generated: number
  status: Invoice['status']
  engine_type: Invoice['engineType']
  created_at: string
}

function rowToInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    messageId: row.message_id,
    date: row.date,
    dateSource: row.date_source ?? null,
    vendor: row.vendor,
    amount: row.amount,
    currency: row.currency,
    localFilePath: row.local_file_path,
    emailBody: row.email_body ?? null,
    generated: row.generated === 1,
    status: row.status,
    engineType: row.engine_type,
    createdAt: row.created_at
  }
}

/**
 * Opens the local SQLite database (creating it on first run) and ensures the
 * schema exists. Stored under the OS-specific userData directory so it persists
 * across launches and stays out of the app bundle.
 */
export function initDatabase(): Database.Database {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'roni-invoices.db')
  db = new Database(dbPath)
  // WAL improves concurrent read/write performance and is the common default for desktop apps.
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id      TEXT,
      date            TEXT,
      date_source     TEXT,
      vendor          TEXT,
      amount          REAL,
      currency        TEXT,
      local_file_path TEXT,
      email_body      TEXT,
      generated       INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',
      engine_type     TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_message_id ON invoices (message_id);
    -- One row per downloaded file. NULLs are allowed many times (SQLite treats
    -- them as distinct), so non-file rows (samples) are unaffected; this lets
    -- the DB itself block duplicate downloads even under concurrent scans.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_local_file_path
      ON invoices (local_file_path);
    -- Simple key/value store for app settings (RONY-12), e.g. the default engine.
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  runMigrations(db)

  // Clean up junk left by earlier builds whose startup self-test inserted a
  // "Self-Test Vendor" row on every launch (now removed at insert time).
  db.exec(`DELETE FROM invoices WHERE message_id LIKE 'selftest-%'`)

  console.log(`[db] SQLite ready at ${dbPath}`)
  return db
}

/**
 * Versioned migration runner. Each step upgrades the DB from version N-1 to N
 * and runs at most once (gated by `PRAGMA user_version`). Brand-new DBs created
 * by the CREATE TABLE above already have the latest shape, so we just stamp them
 * to the current version. Existing pre-versioning DBs report version 0 and get
 * the idempotent column back-fills below.
 */
function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= SCHEMA_VERSION) return

  // --- v0 → v1: columns added after the original release. The ADD COLUMN guards
  // are idempotent (skip if the column already exists), so this is safe on both
  // a fresh CREATE and a long-lived user DB. ---
  if (current < 1) {
    const columns = db.prepare(`PRAGMA table_info(invoices)`).all() as Array<{ name: string }>
    if (!columns.some((c) => c.name === 'date_source')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN date_source TEXT`)
    }
    if (!columns.some((c) => c.name === 'email_body')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN email_body TEXT`)
    }
    if (!columns.some((c) => c.name === 'generated')) {
      db.exec(`ALTER TABLE invoices ADD COLUMN generated INTEGER NOT NULL DEFAULT 0`)
    }
  }

  // Future migrations go here, each guarded by `if (current < N) { … }`.

  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}

function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised — call initDatabase() first.')
  return db
}

/** better-sqlite3 can't bind booleans — map `generated` to 0/1 for the run(). */
function toBindParams(invoice: NewInvoice): Record<string, unknown> {
  return { ...invoice, generated: invoice.generated ? 1 : 0 }
}

export function insertInvoice(invoice: NewInvoice): Invoice {
  const stmt = getDb().prepare(`
    INSERT INTO invoices (message_id, date, date_source, vendor, amount, currency, local_file_path, email_body, generated, status, engine_type)
    VALUES (@messageId, @date, @dateSource, @vendor, @amount, @currency, @localFilePath, @emailBody, @generated, @status, @engineType)
  `)
  const info = stmt.run(toBindParams(invoice))
  return getInvoiceById(Number(info.lastInsertRowid))!
}

export function getInvoiceById(id: number): Invoice | undefined {
  const row = getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as
    | InvoiceRow
    | undefined
  return row ? rowToInvoice(row) : undefined
}

export function listInvoices(): Invoice[] {
  const rows = getDb().prepare('SELECT * FROM invoices ORDER BY id DESC').all() as InvoiceRow[]
  return rows.map(rowToInvoice)
}

export function countInvoices(): number {
  const { n } = getDb().prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }
  return n
}

/** True if an invoice row already references this local file path (RONY-11 dedup). */
export function invoiceExistsByPath(localFilePath: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM invoices WHERE local_file_path = ? LIMIT 1')
    .get(localFilePath)
  return row !== undefined
}

/** True if any row already exists for this Gmail message id (body-only dedup). */
export function invoiceExistsByMessageId(messageId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM invoices WHERE message_id = ? LIMIT 1').get(messageId)
  return row !== undefined
}

/**
 * Insert an invoice, but do nothing if a row with the same `local_file_path`
 * already exists (RONY-11). Returns true if a new row was inserted, false if it
 * was a duplicate — so concurrent scans can't double-insert the same file.
 */
export function tryInsertInvoice(invoice: NewInvoice): boolean {
  const info = getDb()
    .prepare(
      `INSERT INTO invoices (message_id, date, date_source, vendor, amount, currency, local_file_path, email_body, generated, status, engine_type)
       VALUES (@messageId, @date, @dateSource, @vendor, @amount, @currency, @localFilePath, @emailBody, @generated, @status, @engineType)
       ON CONFLICT(local_file_path) DO NOTHING`
    )
    .run(toBindParams(invoice))
  return info.changes > 0
}

/** Delete an invoice row by id. Returns true if a row was actually removed. */
export function deleteInvoice(id: number): boolean {
  const info = getDb().prepare('DELETE FROM invoices WHERE id = ?').run(id)
  return info.changes > 0
}

/* ----------------------------- app settings (RONY-12) ----------------------------- */

/** Read a settings value by key, or undefined if unset. */
export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

/** Upsert a settings value. */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

/**
 * RONY-3 Definition of Done: write a test row, read it back, then REMOVE it —
 * proving the local DB round-trips without leaving junk in the user's dashboard.
 * Intended for dev only (the caller gates it); the inserted row is always
 * cleaned up so even repeated dev launches don't accumulate test rows.
 */
export function runStartupSelfTest(): void {
  const before = countInvoices()
  const inserted = insertInvoice({
    messageId: `selftest-${Date.now()}`,
    date: new Date().toISOString().slice(0, 10),
    dateSource: 'email',
    vendor: 'Self-Test Vendor',
    amount: 123.45,
    currency: 'ILS',
    localFilePath: null,
    emailBody: null,
    generated: false,
    status: 'pending',
    engineType: 'deterministic'
  })
  const readBack = getInvoiceById(inserted.id)
  deleteInvoice(inserted.id) // never pollute the real table
  console.log(
    `[db] startup self-test: wrote+read+removed row #${inserted.id} (count back to ${before}), ` +
      `read back vendor="${readBack?.vendor}", amount=${readBack?.amount}`
  )
}
