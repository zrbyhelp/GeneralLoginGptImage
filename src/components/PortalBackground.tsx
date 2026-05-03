import { useEffect, useRef } from 'react'

type Rgb = readonly [number, number, number]
type Glyph = 'Z' | 'R'
type Triangle = {
  p: readonly [number, number, number, number, number, number]
  tone: number
}
type Tile = {
  col: number
  row: number
  x: number
  y: number
  char: Glyph
  paletteSeed: number
  brightnessSeed: number
  triangleSeed: number
  phase: number
  paletteA: Rgb
  paletteB: Rgb
  brightness: number
}

const BASE_CELL = 68
const MAX_COLS = 34
const MAX_ROWS = 22
const PASTEL_PALETTES: readonly (readonly [Rgb, Rgb])[] = [
  [[248, 182, 194], [255, 224, 168]],
  [[150, 220, 226], [190, 206, 255]],
  [[255, 190, 150], [255, 232, 190]],
  [[210, 184, 248], [156, 228, 214]],
  [[174, 224, 190], [150, 204, 238]],
]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function addQuad(tris: Triangle[], x: number, y: number, w: number, h: number, tone = 0) {
  tris.push(
    { p: [x, y, x + w, y, x, y + h], tone },
    { p: [x + w, y, x + w, y + h, x, y + h], tone: tone + 0.12 },
  )
}

function addSlash(
  tris: Triangle[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness: number,
  tone = 0,
) {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const nx = (-dy / length) * thickness * 0.5
  const ny = (dx / length) * thickness * 0.5

  tris.push(
    { p: [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x1 - nx, y1 - ny], tone },
    { p: [x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny], tone: tone + 0.12 },
  )
}

function makeTemplates(): Record<Glyph, Triangle[]> {
  const z: Triangle[] = []
  addQuad(z, 0.04, 0.08, 0.92, 0.18, 0.08)
  addSlash(z, 0.86, 0.17, 0.14, 0.83, 0.2, 0.28)
  addQuad(z, 0.04, 0.74, 0.92, 0.18, -0.02)

  const r: Triangle[] = []
  addQuad(r, 0.05, 0.08, 0.19, 0.84, -0.04)
  addQuad(r, 0.2, 0.08, 0.54, 0.17, 0.14)
  addQuad(r, 0.2, 0.43, 0.52, 0.16, 0.04)
  addQuad(r, 0.68, 0.18, 0.2, 0.31, 0.22)
  addSlash(r, 0.25, 0.55, 0.88, 0.91, 0.17, 0.36)

  return { Z: z, R: r }
}

const TEMPLATES = makeTemplates()

function hash2(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  return n - Math.floor(n)
}

function createTile(col: number, row: number, cellSize: number): Tile {
  const paletteSeed = hash2(col * 2.17 + 8.5, row * 3.41 + 1.6)
  const palette = PASTEL_PALETTES[Math.floor(paletteSeed * PASTEL_PALETTES.length) % PASTEL_PALETTES.length]

  return {
    col,
    row,
    x: col * cellSize - cellSize * 0.15,
    y: row * cellSize - cellSize * 0.12,
    char: col % 2 === 0 ? 'Z' : 'R',
    paletteSeed,
    brightnessSeed: hash2(col * 4.9, row * 6.3),
    triangleSeed: hash2(col * 12.9 + 1.1, row * 9.7 + 2.4),
    phase: hash2(col + 4.2, row + 8.7) * Math.PI * 2,
    paletteA: palette[0],
    paletteB: palette[1],
    brightness: 0.94 + hash2(col * 4.9, row * 6.3) * 0.12,
  }
}

function colorFor(tile: Tile, triangle: Triangle, index: number) {
  const facetSeed = hash2(tile.triangleSeed * 23.7 + index * 5.1, tile.phase * 0.31 + index * 9.4)
  const hueSeed = hash2(tile.col * 4.6 + index * 1.7, tile.row * 6.2 + index * 2.9)
  const mix = clamp(0.5 + triangle.tone * 0.55 + (facetSeed - 0.5) * 0.16, 0, 1)
  const channelShift = (hueSeed - 0.5) * 10
  const wash = 0.34
  const baseR = lerp(tile.paletteA[0], tile.paletteB[0], mix) * tile.brightness + channelShift
  const baseG = lerp(tile.paletteA[1], tile.paletteB[1], mix) * tile.brightness - channelShift * 0.35
  const baseB = lerp(tile.paletteA[2], tile.paletteB[2], mix) * tile.brightness + (facetSeed - 0.5) * 8
  const alpha = clamp(0.18 + facetSeed * 0.14 + Math.max(triangle.tone, 0) * 0.05, 0.16, 0.34)

  return `rgba(${Math.round(lerp(clamp(baseR, 0, 255), 255, wash))}, ${Math.round(lerp(
    clamp(baseG, 0, 255),
    255,
    wash,
  ))}, ${Math.round(lerp(clamp(baseB, 0, 255), 255, wash))}, ${alpha.toFixed(3)})`
}

function project(tile: Tile, cellSize: number, px: number, py: number) {
  const size = cellSize * 0.94
  const originX = tile.x + cellSize * 0.03
  const originY = tile.y + cellSize * 0.03

  return {
    x: originX + px * size,
    y: originY + py * size,
  }
}

function drawTile(context: CanvasRenderingContext2D, tile: Tile, cellSize: number) {
  const template = TEMPLATES[tile.char]

  for (let i = 0; i < template.length; i += 1) {
    const triangle = template[i]
    const p = triangle.p
    const a = project(tile, cellSize, p[0], p[1])
    const b = project(tile, cellSize, p[2], p[3])
    const c = project(tile, cellSize, p[4], p[5])

    context.fillStyle = colorFor(tile, triangle, i)
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(b.x, b.y)
    context.lineTo(c.x, c.y)
    context.closePath()
    context.fill()
  }
}

function drawBackground(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return

  const width = window.innerWidth
  const height = window.innerHeight
  const dpr = Math.min(window.devicePixelRatio || 1, width * height > 2500000 ? 1.2 : 1.45)
  const cellSize = Math.max(BASE_CELL, Math.ceil(Math.max(width / MAX_COLS, height / MAX_ROWS)))
  const cols = Math.ceil(width / cellSize) + 2
  const rows = Math.ceil(height / cellSize) + 2

  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      drawTile(context, createTile(col, row, cellSize), cellSize)
    }
  }
}

export default function PortalBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let rafId = 0
    const render = () => drawBackground(canvas)
    const scheduleRender = () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0
        render()
      })
    }

    render()
    window.addEventListener('resize', scheduleRender)

    return () => {
      window.removeEventListener('resize', scheduleRender)
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="portal-background pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <div className="absolute inset-0 bg-white/30 dark:bg-black/45" />
    </div>
  )
}
