/**
 * RONY-16 — Secure API-key storage.
 *
 * The user's LLM API keys are encrypted with Electron `safeStorage` (OS
 * keychain/DPAPI) and written to a file under `userData` — the same approach
 * RONY-6 uses for OAuth tokens. Keys are stored per provider and are NEVER
 * returned to the renderer (only a "is a key set?" boolean is exposed).
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AiProvider } from '../../shared/types'

/** What we persist: a provider → key map. */
type KeyMap = Partial<Record<AiProvider, string>>

function keyFilePath(): string {
  return join(app.getPath('userData'), 'api-keys.enc')
}

/** Decrypt + parse the stored map, or {} if absent/unreadable. */
function loadMap(): KeyMap {
  const path = keyFilePath()
  if (!existsSync(path)) return {}
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    const parsed: unknown = JSON.parse(decrypted)
    return parsed && typeof parsed === 'object' ? (parsed as KeyMap) : {}
  } catch {
    // Corrupt or undecryptable (e.g. different OS user) — treat as empty.
    return {}
  }
}

/** Encrypt + persist the map. Deletes the file when nothing is left to store. */
function saveMap(map: KeyMap): void {
  const entries = Object.entries(map).filter(([, value]) => Boolean(value))
  const path = keyFilePath()
  if (entries.length === 0) {
    rmSync(path, { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store the API key safely.')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(Object.fromEntries(entries)))
  writeFileSync(path, encrypted)
}

/** Store (or, for an empty key, clear) the API key for a provider. */
export function setApiKey(provider: AiProvider, key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    clearApiKey(provider)
    return
  }
  const map = loadMap()
  map[provider] = trimmed
  saveMap(map)
}

/** The stored key for a provider, or undefined. Main-process use only. */
export function getApiKey(provider: AiProvider): string | undefined {
  return loadMap()[provider]
}

/** Whether a key is stored for the provider. */
export function hasApiKey(provider: AiProvider): boolean {
  return Boolean(getApiKey(provider))
}

/** Remove the stored key for a provider. */
export function clearApiKey(provider: AiProvider): void {
  const map = loadMap()
  delete map[provider]
  saveMap(map)
}
