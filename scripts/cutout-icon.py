"""
Remove the background from the master art and write a transparent, tightly
cropped square master to resources/icon-source.png — so the app icon is just
the character with no backdrop (the dark vest blends into the old black
background, so a plain colour-key won't work; rembg segments the subject).

Run this whenever the master art changes, then `npm run icon:round` to
regenerate the runtime icon + build assets from the transparent master.

Usage:
    python scripts/cutout-icon.py <path-to-master-art>

Requires: rembg[cpu], pillow  (pip install "rembg[cpu]" pillow)
"""

import sys

from PIL import Image
from rembg import remove

src = sys.argv[1] if len(sys.argv) > 1 else "resources/icon-source.png"

img = Image.open(src).convert("RGBA")
cut = remove(img)  # RGBA with a soft alpha matte around the subject

# Trim the now-transparent margins down to the subject's bounding box.
bbox = cut.getbbox()
if bbox:
    cut = cut.crop(bbox)

# Centre on a square transparent canvas with a small margin so the figure
# doesn't touch the icon edges.
w, h = cut.size
side = max(w, h)
margin = int(side * 0.06)
canvas = side + margin * 2
out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
out.paste(cut, ((canvas - w) // 2, (canvas - h) // 2), cut)

out.save("resources/icon-source.png")
print(f"Wrote transparent master: resources/icon-source.png ({canvas}x{canvas})")
