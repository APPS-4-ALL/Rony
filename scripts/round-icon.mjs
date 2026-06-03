/**
 * Build the app icon from the master art: optionally zoom into the subject
 * (the illustration has a lot of background, which makes the icon read small in
 * the taskbar), mask it into a circle (transparent corners), and regenerate
 * every asset electron-builder ships.
 *
 * Source of truth: resources/icon-source.png (the untouched square art).
 * Idempotent — re-run with `npm run icon:round` whenever the source or ZOOM
 * changes. Tune the crop with `ICON_ZOOM` (e.g. ICON_ZOOM=1.3 npm run icon:round);
 * 1 = no zoom.
 *
 * Outputs:
 *   resources/icon.png  — 1024², used at runtime (BrowserWindow icon → taskbar)
 *   build/icon.png      —  512², electron-builder source
 *   build/icon.ico      — multi-size Windows icon (the packaged .exe + taskbar)
 *
 * Note: build/icon.icns (macOS) is left untouched — regenerate it on a Mac if
 * the dock icon there also needs rounding.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { Jimp } from 'jimp'
import pngToIco from 'png-to-ico'

const SOURCE = 'resources/icon-source.png'
const ZOOM = Number(process.env.ICON_ZOOM || 1.25)

/** Crop a centered square that is `1/ZOOM` of the canvas, then scale back up. */
function zoomToSubject(image, zoom) {
  if (zoom <= 1) return image
  const { width, height } = image.bitmap
  const keep = Math.round(Math.min(width, height) / zoom)
  const x = Math.round((width - keep) / 2)
  const y = Math.round((height - keep) / 2)
  return image.crop({ x, y, w: keep, h: keep }).resize({ w: width, h: height })
}

/**
 * Zero the alpha outside the largest inscribed circle, with a ~1px antialiased
 * edge so the rim is smooth rather than jagged. Mutates the bitmap in place.
 */
function maskCircle(image) {
  const { data, width, height } = image.bitmap
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const radius = Math.min(width, height) / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = radius - Math.hypot(x - cx, y - cy) // >1 inside, <0 outside
      if (edge >= 1) continue // fully inside — leave opaque
      const factor = Math.max(0, Math.min(1, edge)) // 0..1 across the rim
      const alphaIdx = (y * width + x) * 4 + 3
      data[alphaIdx] = Math.round(data[alphaIdx] * factor)
    }
  }
}

/** A round PNG buffer of the master at the given square size. */
async function pngAt(master, size) {
  return master.clone().resize({ w: size, h: size }).getBuffer('image/png')
}

const master = await Jimp.fromBuffer(await readFile(SOURCE))
zoomToSubject(master, ZOOM)
maskCircle(master)

// 1) Runtime icon (1024², what the dev taskbar/window shows).
await writeFile('resources/icon.png', await master.getBuffer('image/png'))

// 2) electron-builder PNG source (512²).
await writeFile('build/icon.png', await pngAt(master, 512))

// 3) Windows .ico — bundle the standard sizes so it stays crisp everywhere.
const icoSizes = [256, 128, 64, 48, 32, 16]
const icoBuffers = await Promise.all(icoSizes.map((size) => pngAt(master, size)))
await writeFile('build/icon.ico', await pngToIco(icoBuffers))

console.log(`✓ Rounded icon (zoom ${ZOOM}×): resources/icon.png, build/icon.png, build/icon.ico`)
