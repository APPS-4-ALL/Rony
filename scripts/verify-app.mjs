// One-shot verification driver: launches the built Electron app via Playwright,
// screenshots the Welcome page, then exercises the IPC->SQLite round-trip by
// clicking the two buttons and reading the resulting UI state.
import { _electron as electron } from 'playwright-core'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOT_DIR = path.join(APP_DIR, 'scripts', 'shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : process.platform === 'win32'
      ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
      : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  env: { ...process.env },
  timeout: 30_000
})

const page = await app.firstWindow()
await page.waitForSelector('h1', { timeout: 15_000 })

const title = await page.textContent('h1')
console.log('WINDOW_TITLE:', title?.trim())
await page.screenshot({ path: path.join(SHOT_DIR, '01-welcome.png') })
console.log('SHOT: 01-welcome.png')

// --- RONY-4: click "Ping main process" -> IPC invoke -> main returns 'pong' ---
const clickByText = (t) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  }, t)

console.log('CLICK Ping ->', await clickByText('Ping main process'))
await sleep(500)
const pingText = await page.evaluate(
  () => document.body.innerText.match(/main replied:\s*\S+/)?.[0] ?? '(no ping text)'
)
console.log('PING_RESULT:', pingText)

// --- RONY-3 via RONY-4: click "Add sample invoice" -> IPC -> SQLite insert ---
const countBefore = await page.evaluate(
  () => document.body.innerText.match(/Rows in local DB:\s*(\d+)/)?.[1] ?? '?'
)
console.log('ROWS_BEFORE:', countBefore)
console.log('CLICK Add sample ->', await clickByText('Add sample invoice'))
await sleep(800)
const countAfter = await page.evaluate(
  () => document.body.innerText.match(/Rows in local DB:\s*(\d+)/)?.[1] ?? '?'
)
console.log('ROWS_AFTER:', countAfter)
const rowCountInTable = await page.evaluate(() => document.querySelectorAll('tbody tr').length)
console.log('TABLE_ROWS:', rowCountInTable)

await page.screenshot({ path: path.join(SHOT_DIR, '02-after-actions.png') })
console.log('SHOT: 02-after-actions.png')

await app.close()
console.log('DONE')
