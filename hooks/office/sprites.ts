// Pure: the office's little people. Pixel-art desk scenes for a Raster (two
// pixels a cell with half blocks) and the same scenes as coloured text-art
// for surfaces or terminals without it. Pose and colour follow the lead's
// status; a capped room gets a red desk and a blinking alarm lamp.

import type { OfficeGraphics, OfficePose } from '../../types'

export const SPRITE_W = 16
export const SPRITE_H = 10 // pixels; the Raster is SPRITE_H / 2 rows
export const TEXT_ART_W = 16

/** 16 x 10 pixel scenes, two frames each. Legend in PALETTE below. */
const SCENES: Record<OfficePose, readonly [readonly string[], readonly string[]]> = {
  busy: [
    [
      '................',
      '...HHH..........',
      '..HSSSS...MMMMMM',
      '..HSESS...MGgGgM',
      '...SSS....MgGgGM',
      '..BBBBAAA.MMMMMM',
      '.CBBBb..kkkk.M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
    [
      '................',
      '...HHH..........',
      '..HSSSS...MMMMMM',
      '..HSESS...MgGgGM',
      '...SSS....MGgGgM',
      '..BBBB....MMMMMM',
      '.CBBBbAAAkkk.M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
  ],
  idle: [
    [
      '................',
      '..HHH...........',
      '.HSSSS....MMMMMM',
      '.HSESS....MKKKKM',
      '..SSS.....MKgKKM',
      '.BBBB.....MMMMMM',
      'CBBBbA..U....M..',
      'CDDDDDDDDDDDDDDD',
      'C..d.........d..',
      'C..d.........d..',
    ],
    [
      '................',
      '..HHH...........',
      '.HSSSS....MMMMMM',
      '.HSESS....MKKKKM',
      '..SSS...u.MKKgKM',
      '.BBBB...u.MMMMMM',
      'CBBBbA..U....M..',
      'CDDDDDDDDDDDDDDD',
      'C..d.........d..',
      'C..d.........d..',
    ],
  ],
  watching: [
    [
      '................',
      '...HHH..........',
      '..HSSSS...MMMMMM',
      '..HSESS...MGGYGM',
      '...SSS....MGGGGM',
      '..BBBB....MMMMMM',
      '.CBBBb.......M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
    [
      '................',
      '...HHH..........',
      '..HSSSS...MMMMMM',
      '..HSESS...MGYGGM',
      '...SSS....MGGGGM',
      '..BBBB....MMMMMM',
      '.CBBBb.......M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
  ],
  waiting: [
    [
      '................',
      '.........u......',
      '..........MMMMMM',
      '..........MKKKKM',
      '..HHH.....MKKKKM',
      '.HSSSB....MMMMMM',
      '.BBBBb.......M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
    [
      '................',
      '.......u.u......',
      '..........MMMMMM',
      '..........MKKKKM',
      '..HHH.....MKKKKM',
      '.HSSSB....MMMMMM',
      '.BBBBb.......M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
  ],
  needs_input: [
    [
      'QQQQ......A.....',
      'QXXQ..HHH.A.....',
      'QQQQ.HSSSAMMMMMM',
      '.Q...HSES.MYYYYM',
      '......SS..MYXYYM',
      '.....BBBB.MMMMMM',
      '.....BBBB....M..',
      '.DDDDBDDBDDDDDDD',
      '...d.B..B....d..',
      '...d.b..b....d..',
    ],
    [
      'QQQQ.....A......',
      'QQQQ..HHH.A.....',
      'QQQQ.HSSSAMMMMMM',
      '.Q...HSES.MYYYYM',
      '......SS..MYYYYM',
      '.....BBBB.MMMMMM',
      '.....BBBB....M..',
      '.DDDDBDDBDDDDDDD',
      '...d.B..B....d..',
      '...d.b..b....d..',
    ],
  ],
  missing: [
    [
      '................',
      '................',
      '..........MMMMMM',
      '..........MKKKKM',
      '..CC......MKKKKM',
      '..CC......MMMMMM',
      '.CCCC........M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
    [
      '................',
      '................',
      '..........MMMMMM',
      '..........MKKKKM',
      '..CC......MKKKKM',
      '..CC......MMMMMM',
      '.CCCC........M..',
      '.CDDDDDDDDDDDDDD',
      '.C.d.........d..',
      '.C.d.........d..',
    ],
  ],
}

export const STATUS_COLOR: Record<OfficePose, number> = {
  busy: 0x3fb950,
  idle: 0x58a6ff,
  needs_input: 0xf0b429,
  missing: 0x6e7681,
  watching: 0x39c5cf,
  waiting: 0x8b7fd6,
}

export const STATUS_LABEL: Record<OfficePose, string> = {
  busy: 'working',
  idle: 'idle',
  needs_input: 'needs input',
  missing: 'not running',
  watching: 'watching',
  waiting: 'waiting',
}

export const STATUS_GLYPH: Record<OfficePose, string> = {
  busy: '●',
  idle: '◌',
  needs_input: '▲',
  missing: '○',
  watching: '◉',
  waiting: '☾',
}

const HAIRS = [0x2b1d14, 0x5a3825, 0xc9a227, 0x1c1c1c, 0x8c3b1e, 0x9aa0a6]
const SKINS = [0xf2c9a0, 0xd9a274, 0xa86b45, 0x7a4a2e, 0xffd9b8]

/** A stable small hash of a name, so each lead keeps its own look. */
export function nameHash(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`
}

function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f))
  const b = Math.min(255, Math.round((c & 255) * f))
  return (r << 16) | (g << 8) | b
}

/** Legend → colour for one lead; null is transparent. */
export function palette(name: string, status: OfficePose, capped: boolean): Record<string, number | null> {
  const h = nameHash(name)
  const shirt = STATUS_COLOR[status]
  const skin = SKINS[h % SKINS.length] ?? 0xf2c9a0
  return {
    '.': null,
    H: HAIRS[(h >>> 8) % HAIRS.length] ?? 0x2b1d14,
    S: skin,
    A: skin,
    E: 0x111111,
    B: shirt,
    b: shade(shirt, 0.6),
    M: 0x30363d,
    G: 0x56d364,
    g: 0x1a7f37,
    K: 0x0d1117,
    Y: 0xf0b429,
    X: 0xff5f56,
    Q: 0xf0f6fc,
    D: capped ? 0x8e2c2c : 0xa0703c,
    d: capped ? 0x5c1a1a : 0x6b4423,
    C: 0x484f58,
    k: 0xc9d1d9,
    U: 0xf0f6fc,
    u: 0x8b949e,
    L: 0xff3b30,
  }
}

/** The scene's pixel rows for a status and animation frame. */
export function scene(status: OfficePose, frame: number, capped: boolean): string[] {
  const rows = [...SCENES[status][frame % 2 === 0 ? 0 : 1]]
  if (capped && frame % 2 === 0) {
    const top = rows[0] ?? ''
    rows[0] = `${top.slice(0, SPRITE_W - 2)}LL`
    const next = rows[1] ?? ''
    rows[1] = `${next.slice(0, SPRITE_W - 2)}LL`
  }
  return rows
}

export const DEFAULT_COLOR = 0x01000000

/** Packs cells as RasterProps wants: LE u32 triplets, padded base64. */
export function packCells(cells: ReadonlyArray<readonly [number, number, number]>): string {
  const bytes = new Uint8Array(cells.length * 12)
  let o = 0
  const put = (v: number) => {
    bytes[o++] = v & 255
    bytes[o++] = (v >>> 8) & 255
    bytes[o++] = (v >>> 16) & 255
    bytes[o++] = (v >>> 24) & 255
  }
  for (const [cp, fg, bg] of cells) {
    put(cp)
    put(fg)
    put(bg)
  }
  return base64(bytes)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}==`
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += `${B64[(n >> 18) & 63]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}=`
  }
  return out
}

const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄

/** Two pixel rows per cell: ▀ with fg = top, bg = bottom; transparent kept. */
export function rasterCells(
  pixels: readonly string[],
  colors: Record<string, number | null>,
): { columns: number; rows: number; cells: string } {
  const columns = Math.max(...pixels.map(r => r.length))
  const rows = Math.ceil(pixels.length / 2)
  const out: Array<[number, number, number]> = []
  for (let r = 0; r < rows; r++) {
    const top = pixels[r * 2] ?? ''
    const bottom = pixels[r * 2 + 1] ?? ''
    for (let c = 0; c < columns; c++) {
      const t = colors[top[c] ?? '.'] ?? null
      const b = colors[bottom[c] ?? '.'] ?? null
      if (t === null && b === null) out.push([0x20, DEFAULT_COLOR, DEFAULT_COLOR])
      else if (t === null) out.push([LOWER, b as number, DEFAULT_COLOR])
      else if (b === null) out.push([UPPER, t, DEFAULT_COLOR])
      else out.push([UPPER, t, b])
    }
  }
  return { columns, rows, cells: packCells(out) }
}

export function spriteRaster(name: string, status: OfficePose, frame: number, capped: boolean) {
  return rasterCells(scene(status, frame, capped), palette(name, status, capped))
}

// ---- text-art --------------------------------------------------------------

type ArtLine = { art: string; mask: string }

/** 4 lines x 16 columns; mask letters use the pixel palette's legend. */
const TEXT_ART: Record<OfficePose, readonly [readonly ArtLine[], readonly ArtLine[]]> = {
  busy: [
    [
      { art: '   ▄▄▄    ▗▄▄▄▄▖', mask: '   HHH    MMMMMM' },
      { art: '  (•‿•)   ▐≡-≡-▌', mask: '  SSSSS   MGgGgM' },
      { art: '  ╭███╮▂▂ ▝▀▜▛▀▘', mask: '  BBBBBAk MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
    [
      { art: '   ▄▄▄    ▗▄▄▄▄▖', mask: '   HHH    MMMMMM' },
      { art: '  (•‿•)   ▐-≡-≡▌', mask: '  SSSSS   MgGgGM' },
      { art: '  ╭███╮▁▂ ▝▀▜▛▀▘', mask: '  BBBBBkA MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
  ],
  idle: [
    [
      { art: '   ▄▄▄    ▗▄▄▄▄▖', mask: '   HHH    MMMMMM' },
      { art: '  (-‿-) z ▐ ·  ▌', mask: '  SSSSS u MKgKKM' },
      { art: '  ╰███╯ ▫ ▝▀▜▛▀▘', mask: '  BBBBB U MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
    [
      { art: '   ▄▄▄  Z ▗▄▄▄▄▖', mask: '   HHH  u MMMMMM' },
      { art: '  (-‿-)   ▐  · ▌', mask: '  SSSSS   MKKgKM' },
      { art: '  ╰███╯ ▫ ▝▀▜▛▀▘', mask: '  BBBBB U MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
  ],
  watching: [
    [
      { art: '   ▄▄▄    ▗▄▄▄▄▖', mask: '   HHH    MMMMMM' },
      { art: '  (•‿•)   ▐✓✓?✓▌', mask: '  SSSSS   MGGYGM' },
      { art: '  ╭███╮   ▝▀▜▛▀▘', mask: '  BBBBB   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
    [
      { art: '   ▄▄▄    ▗▄▄▄▄▖', mask: '   HHH    MMMMMM' },
      { art: '  (•‿•)   ▐✓?✓✓▌', mask: '  SSSSS   MGYGGM' },
      { art: '  ╭███╮   ▝▀▜▛▀▘', mask: '  BBBBB   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
  ],
  waiting: [
    [
      { art: '    z     ▗▄▄▄▄▖', mask: '    u     MMMMMM' },
      { art: '  (-_-)   ▐    ▌', mask: '  SSSSS   MKKKKM' },
      { art: '  ╰███╯   ▝▀▜▛▀▘', mask: '  BBBBB   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
    [
      { art: '   z Z    ▗▄▄▄▄▖', mask: '   u u    MMMMMM' },
      { art: '  (-_-)   ▐    ▌', mask: '  SSSSS   MKKKKM' },
      { art: '  ╰███╯   ▝▀▜▛▀▘', mask: '  BBBBB   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
  ],
  needs_input: [
    [
      { art: '╭─╮  ▄▄▄ ╯▗▄▄▄▄▖', mask: 'QQQ  HHH AMMMMMM' },
      { art: '│!│ (°o°) ▐ ?? ▌', mask: 'QXQ SSSSS MYXXYM' },
      { art: '╰┬╯  ███  ▝▀▜▛▀▘', mask: 'QQQ  BBB  MMMMMM' },
      { art: '▀▀▀▀▀█▀█▀▀▀▀▀▀▀▀', mask: 'DDDDDBDBDDDDDDDD' },
    ],
    [
      { art: '╭─╮  ▄▄▄ ╮▗▄▄▄▄▖', mask: 'QQQ  HHH AMMMMMM' },
      { art: '│ │ (°o°) ▐    ▌', mask: 'QXQ SSSSS MYYYYM' },
      { art: '╰┬╯  ███  ▝▀▜▛▀▘', mask: 'QQQ  BBB  MMMMMM' },
      { art: '▀▀▀▀▀█▀█▀▀▀▀▀▀▀▀', mask: 'DDDDDBDBDDDDDDDD' },
    ],
  ],
  missing: [
    [
      { art: '          ▗▄▄▄▄▖', mask: '          MMMMMM' },
      { art: '   ┌─┐    ▐    ▌', mask: '   CCC    MKKKKM' },
      { art: '  ─┴─┴─   ▝▀▜▛▀▘', mask: '  CCCCC   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
    [
      { art: '          ▗▄▄▄▄▖', mask: '          MMMMMM' },
      { art: '   ┌─┐    ▐    ▌', mask: '   CCC    MKKKKM' },
      { art: '  ─┴─┴─   ▝▀▜▛▀▘', mask: '  CCCCC   MMMMMM' },
      { art: '▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀', mask: 'DDDDDDDDDDDDDDDD' },
    ],
  ],
}

export type ArtSegment = { text: string; color: string | null }

/** Text-art lines, each a run of coloured segments, every line 16 wide. */
export function textArt(name: string, status: OfficePose, frame: number, capped: boolean): ArtSegment[][] {
  const colors = palette(name, status, capped)
  // On a dark terminal the screen-off and monitor colours vanish: lift them.
  const textColor = (key: string): string | null => {
    if (key === ' ') return null
    if (key === 'K') return hex(0x30363d)
    if (key === 'M') return hex(0x6e7681)
    const c = colors[key]
    return c === null || c === undefined ? null : hex(c)
  }
  const lines = TEXT_ART[status][frame % 2 === 0 ? 0 : 1].map(l => ({ ...l }))
  if (capped && frame % 2 === 0) {
    const first = lines[0]
    if (first) {
      const a = Array.from(first.art)
      const m = Array.from(first.mask)
      a[TEXT_ART_W - 1] = '◉'
      m[TEXT_ART_W - 1] = 'L'
      lines[0] = { art: a.join(''), mask: m.join('') }
    }
  }
  return lines.map(({ art, mask }) => {
    const chars = Array.from(art)
    const keys = Array.from(mask)
    const segs: ArtSegment[] = []
    chars.forEach((ch, i) => {
      const color = textColor(keys[i] ?? ' ')
      const last = segs[segs.length - 1]
      if (last && last.color === color) last.text += ch
      else segs.push({ text: ch, color })
    })
    return segs
  })
}

/** Every scene and art line is the size the layout reserves for it. */
export function spriteShapesAreValid(): boolean {
  for (const status of Object.keys(SCENES) as OfficePose[]) {
    for (const frame of SCENES[status]) {
      if (frame.length !== SPRITE_H || frame.some(r => r.length !== SPRITE_W)) return false
    }
    for (const frame of TEXT_ART[status]) {
      for (const l of frame) {
        if (Array.from(l.art).length !== TEXT_ART_W || Array.from(l.mask).length !== TEXT_ART_W) return false
      }
    }
  }
  return true
}

export type GraphicsMode = 'pixel' | 'text'

/**
 * Pixel sprites need the terminal surface (the only one with `Raster`) and
 * true colour (COLORTERM truecolor/24bit, or a terminal known to have it);
 * anything else gets the text-art. The person's choice wins where possible.
 */
export function pickGraphics(
  pref: OfficeGraphics,
  surface: string,
  env: { colorterm?: string | undefined; termProgram?: string | undefined; term?: string | undefined },
): GraphicsMode {
  if (surface !== 'terminal') return 'text'
  if (pref === 'text') return 'text'
  if (pref === 'pixel') return 'pixel'
  const ct = (env.colorterm ?? '').toLowerCase()
  if (ct === 'truecolor' || ct === '24bit') return 'pixel'
  const tp = (env.termProgram ?? '').toLowerCase()
  if (['iterm.app', 'wezterm', 'ghostty', 'vscode', 'windowsterminal', 'kitty'].includes(tp)) return 'pixel'
  const term = (env.term ?? '').toLowerCase()
  if (term.includes('kitty') || term.includes('ghostty') || term.includes('direct')) return 'pixel'
  return 'text'
}
