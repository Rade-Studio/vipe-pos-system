import { describe, expect, it } from "vitest"

import {
  UNIT_OPTIONS,
  convertQuantity,
  formatQuantity,
  normalizeUnit,
  parseQuantityInput,
  quantityPresets,
  quantityStep,
  unitFamily,
} from "./units"

/**
 * T5 (S3, S4, S5) — unit handling shared by the formula builder and the
 * inventory screens. Stored units are accepted verbatim; free-typed aliases
 * normalize to them and quantities convert within one unit family.
 */

const STORED = [
  "kg", "g", "l", "ml", "unidad", "docena", "caja", "botella", "lata",
  "paquete", "bolsa", "porción", "oz", "lb", "cucharada", "cucharadita", "taza",
]

describe("UNIT_OPTIONS", () => {
  it("lists every stored unit in order with Spanish labels and families", () => {
    expect(UNIT_OPTIONS).toEqual([
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
    ])
  })
})

describe("normalizeUnit", () => {
  it("accepts every stored unit verbatim", () => {
    for (const unit of STORED) expect(normalizeUnit(unit)).toBe(unit)
  })

  it.each([
    ["gr", "g"], ["grs", "g"], ["gramo", "g"], ["Gramos", "g"],
    ["kilo", "kg"], ["kilos", "kg"], ["KGS", "kg"],
    ["lt", "l"], ["lts", "l"], ["litro", "l"], ["litros", "l"],
    ["cc", "ml"], ["mililitro", "ml"], ["mililitros", "ml"],
    ["u", "unidad"], ["un", "unidad"], ["und", "unidad"], ["unidades", "unidad"],
    ["pz", "unidad"], ["pieza", "unidad"], ["piezas", "unidad"],
    ["docenas", "docena"],
    ["porcion", "porción"], ["porciones", "porción"], ["PORCIÓN", "porción"],
    ["libra", "lb"], ["libras", "lb"], ["onza", "oz"], ["onzas", "oz"],
    ["cda", "cucharada"], ["cdta", "cucharadita"], ["tazas", "taza"],
    ["cajas", "caja"], ["botellas", "botella"], ["latas", "lata"],
    ["paquetes", "paquete"], ["bolsas", "bolsa"],
    ["  Kg  ", "kg"], ["mili litros", "ml"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeUnit(raw)).toBe(expected)
  })

  it("returns null for unknown units", () => {
    expect(normalizeUnit("galón")).toBeNull()
    expect(normalizeUnit("")).toBeNull()
  })
})

describe("unitFamily", () => {
  it("classifies units and aliases", () => {
    expect(unitFamily("g")).toBe("mass")
    expect(unitFamily("lb")).toBe("mass")
    expect(unitFamily("taza")).toBe("volume")
    expect(unitFamily("docena")).toBe("count")
    expect(unitFamily("caja")).toBe("standalone")
    expect(unitFamily("gramos")).toBe("mass")
    expect(unitFamily("galón")).toBeNull()
  })
})

describe("convertQuantity", () => {
  it.each([
    [1, "kg", "g", 1000],
    [1, "lb", "g", 453.592],
    [1, "oz", "g", 28.3495],
    [1500, "g", "kg", 1.5],
    [1, "l", "ml", 1000],
    [1, "taza", "ml", 240],
    [1, "cucharada", "ml", 15],
    [1, "cucharadita", "ml", 5],
    [2, "docena", "unidad", 24],
    [3, "caja", "caja", 3],
  ])("converts %d %s to %s = %d", (value, from, to, expected) => {
    expect(convertQuantity(value, from, to)).toBeCloseTo(expected, 6)
  })

  it("returns null across families, for standalone to another unit and for unknown units", () => {
    expect(convertQuantity(1, "lb", "ml")).toBeNull()
    expect(convertQuantity(1, "caja", "botella")).toBeNull()
    expect(convertQuantity(1, "caja", "unidad")).toBeNull()
    expect(convertQuantity(1, "galón", "ml")).toBeNull()
    expect(convertQuantity(1, "g", "galón")).toBeNull()
  })
})

describe("parseQuantityInput", () => {
  it.each([
    ["500", "g", 500],
    ["1.5 kg", "g", 1500],
    ["1,5kg", "g", 1500],
    ["1/2 kg", "g", 500],
    ["1 1/2 l", "ml", 1500],
    ["250g", "kg", 0.25],
    ["  2  ", "unidad", 2],
    ["1 docena", "unidad", 12],
    ["3 cajas", "caja", 3],
  ])("parses %j into %s = %d", (input, target, expected) => {
    const result = parseQuantityInput(input, target)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeCloseTo(expected, 6)
  })

  it.each([
    ["", "g", "Ingresa una cantidad"],
    ["   ", "g", "Ingresa una cantidad"],
    ["0", "g", "La cantidad debe ser mayor que cero"],
    ["-2 kg", "g", "La cantidad debe ser mayor que cero"],
    ["abc", "g", "Cantidad no válida"],
    ["1/0 kg", "g", "Cantidad no válida"],
    ["2 galones", "ml", "Unidad desconocida: galones"],
    ["1 lb", "ml", "No se puede convertir lb a ml"],
  ])("rejects %j into %s with %j", (input, target, error) => {
    expect(parseQuantityInput(input, target)).toEqual({ ok: false, error })
  })
})

describe("formatQuantity", () => {
  it("uses es-CO format with at most 3 decimals and trimmed zeros", () => {
    expect(formatQuantity(1.5, "kg")).toBe("1,5 kg")
    expect(formatQuantity(250, "g")).toBe("250 g")
    expect(formatQuantity(1.23456, "l")).toBe("1,235 l")
    expect(formatQuantity(2.0, "unidad")).toBe("2 unidad")
    expect(formatQuantity(1500, "g")).toBe("1.500 g")
  })

  it("auto-scales g/ml up at 1000 and kg/l down below 1", () => {
    expect(formatQuantity(1500, "g", { autoScale: true })).toBe("1,5 kg")
    expect(formatQuantity(1000, "ml", { autoScale: true })).toBe("1 l")
    expect(formatQuantity(999, "g", { autoScale: true })).toBe("999 g")
    expect(formatQuantity(0.25, "kg", { autoScale: true })).toBe("250 g")
    expect(formatQuantity(0.5, "l", { autoScale: true })).toBe("500 ml")
    expect(formatQuantity(1, "kg", { autoScale: true })).toBe("1 kg")
    expect(formatQuantity(1500, "unidad", { autoScale: true })).toBe("1.500 unidad")
  })
})

describe("quantityPresets", () => {
  it.each([
    ["g", [5, 10, 25, 50, 100, 250]],
    ["kg", [0.05, 0.1, 0.25, 0.5, 1]],
    ["ml", [5, 10, 30, 50, 100, 250]],
    ["l", [0.05, 0.1, 0.25, 0.5, 1]],
    ["unidad", [1, 2, 3, 4, 6, 12]],
    ["docena", [1, 2, 3, 4, 6, 12]],
    ["bolsa", [1, 2, 3, 4, 6, 12]],
    ["oz", [0.25, 0.5, 1, 2]],
    ["lb", [0.25, 0.5, 1, 2]],
    ["taza", [0.25, 0.5, 1, 2]],
    ["cucharada", [0.25, 0.5, 1, 2]],
    ["cucharadita", [0.25, 0.5, 1, 2]],
  ])("presets for %s", (unit, expected) => {
    expect(quantityPresets(unit)).toEqual(expected)
  })
})

describe("quantityStep", () => {
  it.each([
    ["g", 5], ["ml", 5],
    ["kg", 0.05], ["l", 0.05], ["lb", 0.05],
    ["oz", 0.25], ["taza", 0.25], ["cucharada", 0.25], ["cucharadita", 0.25],
    ["unidad", 1], ["docena", 1], ["caja", 1], ["porción", 1],
  ])("step for %s is %d", (unit, expected) => {
    expect(quantityStep(unit)).toBe(expected)
  })
})
