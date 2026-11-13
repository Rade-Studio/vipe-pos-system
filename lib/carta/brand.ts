/**
 * Tenant brand color per theme (S3). The restaurant picks one color; the carta
 * derives, for each theme, a fill (`brand`), the text drawn on it
 * (`brandContrast`), a quiet tint, a line and the brand-colored text on the
 * canvas (`brandText`), stepping the color darker (light theme) or lighter
 * (dark theme) until every text pair passes WCAG AA (4.5:1), as the
 * artboard's `--brand*` do.
 */

export interface BrandTheme {
  brand: string
  brandContrast: string
  brandTint: string
  brandLine: string
  brandText: string
}

export interface BrandPalette {
  light: BrandTheme
  dark: BrandTheme
}

/** The app's violet accent, used when the restaurant has not chosen a color. */
export const DEFAULT_BRAND = "#7c3aed"
export const AA = 4.5

/** Canvases of the two themes (app/globals.css `--canvas`). */
export const LIGHT_CANVAS = "#fafafa"
export const DARK_CANVAS = "#07060d"
const WHITE = "#ffffff"
const INK = "#09090b"

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two hex colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a)
  const rb = parseHex(b)
  if (!ra || !rb) return 1
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Moves `color` toward `target` in small steps until `ok` holds. */
function stepUntil(color: Rgb, target: Rgb, ok: (hex: string) => boolean): string {
  for (let i = 0; i <= 20; i++) {
    const hex = toHex(mix(color, target, i / 20))
    if (ok(hex)) return hex
  }
  return toHex(target)
}

export function brandPalette(input: string | null | undefined): BrandPalette {
  const base = parseHex(input ?? "") ?? (parseHex(DEFAULT_BRAND) as Rgb)
  const white = parseHex(WHITE) as Rgb
  const ink = parseHex(INK) as Rgb
  const darkCanvas = parseHex(DARK_CANVAS) as Rgb

  // Light: a dark fill with white text; the same color reads on the canvas.
  const lightBrand = stepUntil(base, ink, (hex) => contrastRatio(hex, WHITE) >= AA && contrastRatio(hex, LIGHT_CANVAS) >= AA)
  // Dark: a light fill with ink text; the same color reads on the canvas.
  const darkBrand = stepUntil(base, white, (hex) => contrastRatio(hex, INK) >= AA && contrastRatio(hex, DARK_CANVAS) >= AA)

  return {
    light: {
      brand: lightBrand,
      brandContrast: WHITE,
      brandTint: toHex(mix(base, white, 0.86)),
      brandLine: toHex(mix(base, white, 0.55)),
      brandText: lightBrand,
    },
    dark: {
      brand: darkBrand,
      brandContrast: INK,
      brandTint: toHex(mix(base, darkCanvas, 0.8)),
      brandLine: toHex(mix(base, darkCanvas, 0.45)),
      brandText: darkBrand,
    },
  }
}

function declarations(theme: BrandTheme): string {
  return [
    `--brand:${theme.brand}`,
    `--brand-contrast:${theme.brandContrast}`,
    `--brand-tint:${theme.brandTint}`,
    `--brand-line:${theme.brandLine}`,
    `--brand-text:${theme.brandText}`,
  ].join(";")
}

/**
 * CSS for the carta root: the light values, and the dark ones under the app's
 * `.dark` class (next-themes follows the phone's `prefers-color-scheme`).
 * `--brand-story` is the dark fill of the share preview, which keeps white
 * text in both themes.
 */
export function brandCss(palette: BrandPalette, selector = ".carta-root"): string {
  const story = `--brand-story:${palette.light.brand}`
  return `${selector}{${declarations(palette.light)};${story}}.dark ${selector}{${declarations(palette.dark)}}`
}
