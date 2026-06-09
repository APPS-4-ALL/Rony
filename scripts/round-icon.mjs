/**
 * Regenerate every app-icon asset from the transparent master.
 *
 * Source of truth: resources/icon-source.png — a background-removed, tightly
 * cropped square cutout of the character (produced by scripts/cutout-icon.py).
 * Because the master is already transparent and trimmed to the subject, this
 * step only resizes: there is no backdrop to round off and no margin to zoom
 * past. Idempotent — re-run with `npm run icon:round` whenever the master
 * changes.
 *
 * Outputs:
 *   resources/icon.png  — 512², used at runtime (BrowserWindow icon → taskbar)
 *   build/icon.png      — 512², electron-builder source
 *   build/icon.ico      — multi-size Windows icon (the packaged .exe + taskbar)
 *
 * Note: build/icon.icns (macOS) is left untouched — regenerate it on a Mac if
 * the dock icon there also needs updating.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { Jimp } from 'jimp'
import pngToIco from 'png-to-ico'

const SOURCE = 'resources/icon-source.png'

/** A PNG buffer of the master resized to a square of the given size. */
async function pngAt(master, size) {
  return master.clone().resize({ w: size, h: size }).getBuffer('image/png')
}

const master = await Jimp.fromBuffer(await readFile(SOURCE))

// 1) Runtime icon (512², what the dev taskbar/window shows — plenty for any
// icon size, and keeps the file small vs. the multi-MB source art).
await writeFile('resources/icon.png', await pngAt(master, 512))

// 2) electron-builder PNG source (512²).
await writeFile('build/icon.png', await pngAt(master, 512))

// 3) Windows .ico — bundle the standard sizes so it stays crisp everywhere.
const icoSizes = [256, 128, 64, 48, 32, 16]
const icoBuffers = await Promise.all(icoSizes.map((size) => pngAt(master, size)))
await writeFile('build/icon.ico', await pngToIco(icoBuffers))

console.log('✓ Icon assets regenerated from transparent master: resources/icon.png, build/icon.png, build/icon.ico')
