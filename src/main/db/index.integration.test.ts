/**
 * Integration test for encryption-at-rest, exercising the FULL stack: a real
 * better-sqlite3 database + the db module's insert/read/migration paths.
 *
 * better-sqlite3 is a native addon, and CI deliberately skips the postinstall
 * rebuild, so the binding may be absent there. We probe for it once and
 * `describe.skipIf` the whole suite when it's unavailable — giving local
 * development real end-to-end confidence without ever red-failing CI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NewInvoice } from '../../shared/types'

/* Reversible mock cipher (no real OS keyring needed in tests): encrypt prefixes
 * "ENC:" and returns a Buffer; decrypt strips it and rejects anything else. */
const encryptString = (s: string): Buffer => Buffer.from(`ENC:${s}`, 'utf-8')
const decryptString = (b: Buffer): string => {
  const s = b.toString('utf-8')
  if (!s.startsWith('ENC:')) throw new Error('cannot decrypt')
  return s.slice('ENC:'.length)
}

/* The db module reads app.getPath('userData') at init time; point it at a fresh
 * temp dir per test (set in beforeEach, before the module is imported). */
let userDataDir = ''
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => encryptString(s),
    decryptString: (b: Buffer) => decryptString(b)
  }
}))

// Probe for the native binding; skip the suite cleanly when it can't load.
// NOTE: in this repo better-sqlite3 is compiled for ELECTRON's Node ABI, so it
// won't load under vitest's system Node (you'll see an ABI mismatch) — the suite
// skips there too, not only in CI. To actually execute it, run vitest under a
// runtime whose ABI matches the built binding (e.g. after `npm rebuild
// better-sqlite3` against your Node, or via an Electron-based test runner).
let nativeAvailable = true
let skipReason = ''
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Database: any
try {
  Database = (await import('better-sqlite3')).default
  new Database(':memory:').close()
} catch (e) {
  nativeAvailable = false
  skipReason = (e instanceof Error ? e.message : String(e)).split('\n')[0]
}
if (!nativeAvailable) {
  console.warn(
    `[db integration] skipping encryption-at-rest integration suite — ` +
      `better-sqlite3 not loadable here: ${skipReason}`
  )
}

const dbFile = (): string => join(userDataDir, 'roni-invoices.db')

const sample: NewInvoice = {
  messageId: 'm-new',
  date: '2026-06-01',
  dateSource: 'email',
  vendor: 'Acme Ltd',
  amount: 1234.56,
  currency: 'ILS',
  localFilePath: join(tmpdir(), 'rony-int-inv.pdf'),
  emailBody: 'secret receipt body',
  generated: false,
  status: 'pending',
  engineType: 'deterministic'
}

describe.skipIf(!nativeAvailable)(
  'db encryption at rest (integration, needs better-sqlite3)',
  () => {
    beforeEach(() => {
      vi.resetModules() // fresh db singleton (and a fresh connection) per test
      userDataDir = mkdtempSync(join(tmpdir(), 'rony-db-'))
    })

    afterEach(() => {
      // The module's connection stays open (no close export); on Windows that can
      // lock the files, so deleting the temp dir is best-effort.
      try {
        rmSync(userDataDir, { recursive: true, force: true })
      } catch {
        /* leaked temp dir — OS tmp cleanup handles it */
      }
    })

    it('encrypts vendor/amount/email_body on insert and decrypts them on read', async () => {
      const db = await import('./index')
      db.initDatabase()

      const inserted = db.insertInvoice(sample)
      // Read path decrypts transparently.
      expect(inserted.vendor).toBe('Acme Ltd')
      expect(inserted.amount).toBe(1234.56)
      expect(inserted.emailBody).toBe('secret receipt body')
      expect(db.getInvoiceById(inserted.id)?.vendor).toBe('Acme Ltd')

      // At rest the three columns are ciphertext BLOBs, not plaintext.
      const raw = new Database(dbFile(), { readonly: true })
      const row = raw
        .prepare('SELECT vendor, amount, email_body, currency FROM invoices WHERE id = ?')
        .get(inserted.id)
      raw.close()
      expect(Buffer.isBuffer(row.vendor)).toBe(true)
      expect(row.vendor.toString('utf-8')).toBe('ENC:Acme Ltd')
      expect(Buffer.isBuffer(row.amount)).toBe(true)
      expect(row.amount.toString('utf-8')).toBe('ENC:1234.56')
      expect(Buffer.isBuffer(row.email_body)).toBe(true)
      // Non-sensitive columns remain plaintext.
      expect(row.currency).toBe('ILS')
    })

    it('migrates a legacy plaintext v1 DB to encrypted columns on open', async () => {
      // Hand-craft a pre-encryption database: plaintext row, schema version 1.
      const legacy = new Database(dbFile())
      legacy.exec(`
      CREATE TABLE invoices (
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
    `)
      legacy
        .prepare(
          `INSERT INTO invoices (message_id, vendor, amount, email_body, engine_type)
         VALUES (?, ?, ?, ?, ?)`
        )
        .run('m-legacy', 'Legacy Vendor', 500.5, 'legacy body text', 'deterministic')
      legacy.pragma('user_version = 1')
      legacy.close()

      // Opening through the db module runs the v1→v2 migration.
      const db = await import('./index')
      db.initDatabase()

      const migrated = db.listInvoices().find((r) => r.messageId === 'm-legacy')
      expect(migrated).toBeDefined()
      expect(migrated?.vendor).toBe('Legacy Vendor')
      expect(migrated?.amount).toBe(500.5)
      expect(migrated?.emailBody).toBe('legacy body text')

      // The row is now ciphertext at rest, and the schema is stamped to v2.
      const raw = new Database(dbFile(), { readonly: true })
      const row = raw
        .prepare('SELECT vendor, amount, email_body FROM invoices WHERE message_id = ?')
        .get('m-legacy')
      const version = raw.pragma('user_version', { simple: true })
      raw.close()
      expect(Buffer.isBuffer(row.vendor)).toBe(true)
      expect(row.vendor.toString('utf-8')).toBe('ENC:Legacy Vendor')
      expect(Buffer.isBuffer(row.amount)).toBe(true)
      expect(Buffer.isBuffer(row.email_body)).toBe(true)
      expect(version).toBe(2)
    })

    it('is idempotent — re-running the migration leaves values intact', async () => {
      const db = await import('./index')
      db.initDatabase()
      const inserted = db.insertInvoice({ ...sample, messageId: 'm-idem', localFilePath: null })

      // Force the migration to run again by resetting the version, then reopening.
      const bump = new Database(dbFile())
      bump.pragma('user_version = 1')
      bump.close()

      vi.resetModules()
      const db2 = await import('./index')
      db2.initDatabase() // v1→v2 runs over already-encrypted rows

      const row = db2.getInvoiceById(inserted.id)
      expect(row?.vendor).toBe('Acme Ltd')
      expect(row?.amount).toBe(1234.56)
    })
  }
)
