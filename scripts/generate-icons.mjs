/**
 * 產生 PWA 圖示（純 Node.js，無需額外套件）
 * ------------------------------------------------------------------
 * 執行：npm run generate:icons
 * 產出：public/pwa-192x192.png、pwa-512x512.png、
 *       pwa-maskable-512x512.png、apple-touch-icon.png
 *
 * 圖示內容是簡單的幾何巴士圖形（深藍底 + 白色車身 + 琥珀色輪子／腰線），
 * 不含任何官方商標，避免使用未授權的品牌圖檔。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const PUBLIC_DIR = path.join(process.cwd(), 'public')
const SS = 2 // 超取樣倍率，用來產生平滑邊緣

const NAVY = [15, 23, 42]
const WHITE = [248, 250, 252]
const AMBER = [245, 183, 0]
const SKY = [56, 189, 248]

const inRoundRect = (nx, ny, x0, y0, x1, y1, radius) => {
  if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return false
  const cx = Math.min(Math.max(nx, x0 + radius), x1 - radius)
  const cy = Math.min(Math.max(ny, y0 + radius), y1 - radius)
  return (nx - cx) ** 2 + (ny - cy) ** 2 <= radius ** 2
}

const inCircle = (nx, ny, cx, cy, radius) => (nx - cx) ** 2 + (ny - cy) ** 2 <= radius ** 2

/** 依序繪製：底 → 車輪 → 車身 → 車窗 → 腰線 → 車頭燈 */
function colorAt(nx, ny, { maskable }) {
  if (!maskable && !inRoundRect(nx, ny, 0, 0, 1, 1, 0.22)) return null

  let color = NAVY
  if (inCircle(nx, ny, 0.33, 0.706, 0.058) || inCircle(nx, ny, 0.67, 0.706, 0.058)) color = AMBER
  if (inRoundRect(nx, ny, 0.2, 0.25, 0.8, 0.7, 0.075)) color = WHITE
  if (
    inRoundRect(nx, ny, 0.26, 0.325, 0.47, 0.45, 0.022) ||
    inRoundRect(nx, ny, 0.53, 0.325, 0.74, 0.45, 0.022)
  ) {
    color = NAVY
  }
  if (inRoundRect(nx, ny, 0.26, 0.5, 0.74, 0.55, 0.012)) color = AMBER
  if (inCircle(nx, ny, 0.27, 0.645, 0.022) || inCircle(nx, ny, 0.73, 0.645, 0.022)) color = SKY
  return color
}

/** 先以 SS 倍解析度逐點上色，再平均降採樣產生抗鋸齒 */
function renderRgba(size, options) {
  const hi = size * SS
  const out = Buffer.alloc(size * size * 4)
  const samples = SS * SS

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const nx = (x * SS + sx + 0.5) / hi
          const ny = (y * SS + sy + 0.5) / hi
          const color = colorAt(nx, ny, options)
          if (!color) continue
          r += color[0]
          g += color[1]
          b += color[2]
          a += 1
        }
      }

      const index = (y * size + x) * 4
      if (a === 0) {
        out.writeUInt32BE(0, index)
        continue
      }
      out[index] = Math.round(r / a)
      out[index + 1] = Math.round(g / a)
      out[index + 2] = Math.round(b / a)
      out[index + 3] = Math.round((a / samples) * 255)
    }
  }

  return out
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
]

fs.mkdirSync(PUBLIC_DIR, { recursive: true })
for (const target of targets) {
  const png = encodePng(target.size, renderRgba(target.size, { maskable: target.maskable }))
  fs.writeFileSync(path.join(PUBLIC_DIR, target.file), png)
  console.log(`✔ public/${target.file} (${target.size}x${target.size})`)
}
