import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const size = 256
const png = new PNG({ width: size, height: size })

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (size * y + x) << 2
  png.data[i] = r
  png.data[i + 1] = g
  png.data[i + 2] = b
  png.data[i + 3] = a
}

function fillRounded(radius) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - 1 - x)
      const dy = Math.min(y, size - 1 - y)
      const inside = dx >= radius || dy >= radius || (radius - dx) ** 2 + (radius - dy) ** 2 <= radius ** 2
      if (inside) set(x, y, 79, 70, 229, 255)
    }
  }
}

function ellipse(cx, cy, rx, ry, color) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) set(x, y, color[0], color[1], color[2], color[3])
    }
  }
}

fillRounded(48)
ellipse(128, 78, 62, 22, [255, 255, 255, 255])
ellipse(128, 78, 46, 14, [224, 231, 255, 255])
for (let y = 78; y <= 178; y++) {
  for (let x = 66; x <= 190; x++) set(x, y, 255, 255, 255, 255)
}
ellipse(128, 178, 62, 22, [255, 255, 255, 255])
ellipse(128, 128, 62, 16, [224, 231, 255, 255])

const dir = path.resolve('build')
fs.mkdirSync(dir, { recursive: true })
const pngBuffer = PNG.sync.write(png)
fs.writeFileSync(path.join(dir, 'icon.png'), pngBuffer)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0)
entry.writeUInt8(0, 1)
entry.writeUInt8(0, 2)
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(pngBuffer.length, 8)
entry.writeUInt32LE(22, 12)
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, entry, pngBuffer]))
console.log('Wrote build/icon.png and build/icon.ico')
