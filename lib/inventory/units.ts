/**
 * Units of measure for inventory items and formula lines. Stored unit strings
 * are canonical; free-typed aliases normalize to them, and quantities convert
 * only within one family (standalone units convert only to themselves).
 */

export type UnitFamily = "mass" | "volume" | "count" | "standalone"

export const UNIT_OPTIONS: { value: string; label: string; family: UnitFamily }[] = [
  { value: "kg", label: "Kilogramos (kg)", family: "mass" },
  { value: "g", label: "Gramos (g)", family: "mass" },
  { value: "l", label: "Litros (l)", family: "volume" },
  { value: "ml", label: "Mililitros (ml)", family: "volume" },
  { value: "unidad", label: "Unidad", family: "count" },
  { value: "docena", label: "Docena", family: "count" },
  { value: "caja", label: "Caja", family: "standalone" },
  { value: "botella", label: "Botella", family: "standalone" },
  { value: "lata", label: "Lata", family: "standalone" },
  { value: "paquete", label: "Paquete", family: "standalone" },
  { value: "bolsa", label: "Bolsa", family: "standalone" },
  { value: "porción", label: "Porción", family: "standalone" },
  { value: "oz", label: "Onzas (oz)", family: "mass" },
  { value: "lb", label: "Libras (lb)", family: "mass" },
  { value: "cucharada", label: "Cucharada", family: "volume" },
  { value: "cucharadita", label: "Cucharadita", family: "volume" },
  { value: "taza", label: "Taza", family: "volume" },
]

/** Size of one unit in its family's base unit (g, ml, unidad). */
const BASE_FACTOR: Record<string, number> = {
  g: 1, kg: 1000, lb: 453.592, oz: 28.3495,
  ml: 1, l: 1000, taza: 240, cucharada: 15, cucharadita: 5,
  unidad: 1, docena: 12,
}

const FAMILY = new Map(UNIT_OPTIONS.map((o) => [o.value, o.family]))

/** Keys are folded (lowercase, no accents, no spaces). */
const ALIASES: Record<string, string> = {
  gr: "g", grs: "g", gramo: "g", gramos: "g",
  kilo: "kg", kilos: "kg", kgs: "kg",
  lt: "l", lts: "l", litro: "l", litros: "l",
  cc: "ml", mililitro: "ml", mililitros: "ml",
  u: "unidad", un: "unidad", und: "unidad", unidades: "unidad",
  pz: "unidad", pieza: "unidad", piezas: "unidad",
  docenas: "docena",
  porcion: "porción", porciones: "porción",
  libra: "lb", libras: "lb", onza: "oz", onzas: "oz",
  cda: "cucharada", cdta: "cucharadita", tazas: "taza",
  cajas: "caja", botellas: "botella", latas: "lata", paquetes: "paquete", bolsas: "bolsa",
}

const fold = (raw: string) =>
  raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "").toLowerCase()

const CANONICAL = new Map(UNIT_OPTIONS.map((o) => [fold(o.value), o.value]))

export function normalizeUnit(raw: string): string | null {
  const key = fold(raw)
  if (!key) return null
  return CANONICAL.get(key) ?? ALIASES[key] ?? null
}

export function unitFamily(unit: string): UnitFamily | null {
  const canonical = normalizeUnit(unit)
  return canonical ? FAMILY.get(canonical) ?? null : null
}

export function convertQuantity(value: number, from: string, to: string): number | null {
  const a = normalizeUnit(from)
  const b = normalizeUnit(to)
  if (!a || !b) return null
  if (a === b) return value
  if (FAMILY.get(a) !== FAMILY.get(b) || FAMILY.get(a) === "standalone") return null
  return (value * BASE_FACTOR[a]) / BASE_FACTOR[b]
}

const QUANTITY_RE = /^(-?)(?:(\d+)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d+(?:[.,]\d+)?|[.,]\d+))\s*(\D*)$/

export function parseQuantityInput(
  input: string,
  targetUnit: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const text = input.trim()
  if (!text) return { ok: false, error: "Ingresa una cantidad" }
  const match = QUANTITY_RE.exec(text)
  if (!match) return { ok: false, error: "Cantidad no válida" }
  const [, sign, whole, mixedNum, mixedDen, num, den, decimal, unitText] = match

  let value: number
  if (whole !== undefined) {
    if (Number(mixedDen) === 0) return { ok: false, error: "Cantidad no válida" }
    value = Number(whole) + Number(mixedNum) / Number(mixedDen)
  } else if (num !== undefined) {
    if (Number(den) === 0) return { ok: false, error: "Cantidad no válida" }
    value = Number(num) / Number(den)
  } else {
    value = Number(decimal.replace(",", "."))
  }
  if (sign) value = -value
  if (!(value > 0)) return { ok: false, error: "La cantidad debe ser mayor que cero" }

  const target = normalizeUnit(targetUnit) ?? targetUnit
  const rawUnit = unitText.trim()
  if (!rawUnit) return { ok: true, value }
  const from = normalizeUnit(rawUnit)
  if (!from) return { ok: false, error: `Unidad desconocida: ${rawUnit}` }
  const converted = convertQuantity(value, from, target)
  if (converted === null) return { ok: false, error: `No se puede convertir ${from} a ${target}` }
  return { ok: true, value: converted }
}

const NUMBER_FORMAT = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 })

export function formatQuantity(value: number, unit: string, opts: { autoScale?: boolean } = {}): string {
  let shown = value
  let shownUnit = unit
  if (opts.autoScale) {
    const abs = Math.abs(value)
    if ((unit === "g" || unit === "ml") && abs >= 1000) {
      shown = value / 1000
      shownUnit = unit === "g" ? "kg" : "l"
    } else if ((unit === "kg" || unit === "l") && abs > 0 && abs < 1) {
      shown = value * 1000
      shownUnit = unit === "kg" ? "g" : "ml"
    }
  }
  return `${NUMBER_FORMAT.format(shown)} ${shownUnit}`
}

export function quantityPresets(unit: string): number[] {
  const canonical = normalizeUnit(unit) ?? unit
  switch (canonical) {
    case "g": return [5, 10, 25, 50, 100, 250]
    case "ml": return [5, 10, 30, 50, 100, 250]
    case "kg":
    case "l": return [0.05, 0.1, 0.25, 0.5, 1]
    case "oz":
    case "lb":
    case "taza":
    case "cucharada":
    case "cucharadita": return [0.25, 0.5, 1, 2]
    default: return [1, 2, 3, 4, 6, 12]
  }
}

export function quantityStep(unit: string): number {
  const canonical = normalizeUnit(unit) ?? unit
  switch (canonical) {
    case "g":
    case "ml": return 5
    case "kg":
    case "l":
    case "lb": return 0.05
    case "oz":
    case "taza":
    case "cucharada":
    case "cucharadita": return 0.25
    default: return 1
  }
}
