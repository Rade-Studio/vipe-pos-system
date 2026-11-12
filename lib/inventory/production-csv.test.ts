import { describe, expect, it } from "vitest"

import type { ProductionBatch } from "@/lib/api/inventory/types"
import { batchesCsv, parseCsvDecimal, parseProductionCsv, productionTemplateCsv } from "./production-csv"

const preps = [
  { id: "p2", sku: "PR-0002", name: "Pico de gallo", unit: "kg" },
  { id: "p1", sku: "PR-0001", name: "Arepa; paisa", unit: "unidad" },
]

describe("productionTemplateCsv", () => {
  it("lists every preparation by name with a BOM and an empty cantidad", () => {
    expect(productionTemplateCsv(preps)).toBe(
      "\uFEFFcodigo;preparacion;unidad;cantidad\r\nPR-0001;\"Arepa; paisa\";unidad;\r\nPR-0002;Pico de gallo;kg;\r\n",
    )
  })
})

describe("parseCsvDecimal", () => {
  it("reads es-CO decimals and thousands", () => {
    expect(parseCsvDecimal("27,5")).toBe(27.5)
    expect(parseCsvDecimal("1.250,5")).toBe(1250.5)
    expect(parseCsvDecimal("1.250")).toBe(1250)
    expect(parseCsvDecimal("2.5")).toBe(2.5)
    expect(parseCsvDecimal(" 150 ")).toBe(150)
    expect(Number.isNaN(parseCsvDecimal("abc"))).toBe(true)
    expect(Number.isNaN(parseCsvDecimal(""))).toBe(true)
  })
})

describe("parseProductionCsv", () => {
  it("reads columns by header name, ignores empty quantities and reports unknown codes", () => {
    const text =
      "\uFEFFcantidad;Código;preparacion\r\n4,5;pr-0002;Pico de gallo\r\n;PR-0001;Arepa\r\n3;PR-0099;Torta\r\n\r\n"
    expect(parseProductionCsv(text, preps)).toEqual({
      ok: true,
      quantities: { p2: 4.5 },
      unknown: ["PR-0099"],
      invalid: [],
    })
  })

  it("accepts comma-separated files and reports invalid quantities", () => {
    const text = "codigo,preparacion,unidad,cantidad\nPR-0001,Arepa,unidad,150\nPR-0002,Pico,kg,mucho\n"
    expect(parseProductionCsv(text, preps)).toEqual({
      ok: true,
      quantities: { p1: 150 },
      unknown: [],
      invalid: ["PR-0002"],
    })
  })

  it("adds repeated rows of one preparation", () => {
    const text = "codigo;cantidad\nPR-0002;1\nPR-0002;0,5\n"
    expect(parseProductionCsv(text, preps)).toMatchObject({ quantities: { p2: 1.5 } })
  })

  it("rejects a file without the codigo and cantidad headers", () => {
    expect(parseProductionCsv("a;b\n1;2\n", preps)).toEqual({
      ok: false,
      error: "El archivo no tiene las columnas codigo y cantidad. Descarga la plantilla y úsala como base.",
    })
  })
})

describe("batchesCsv", () => {
  it("exports the rows with es-CO decimals", () => {
    const b = {
      id: "b1",
      itemId: "salsa",
      itemName: "Salsa roja",
      unit: "l",
      locationId: "l",
      locationName: "Cocina",
      lotId: null,
      lotCode: "PB-1",
      quantity: 1.5,
      unitCost: 1500,
      totalCost: 2250,
      expiresOn: "2026-11-14",
      notes: null,
      producedOn: "2026-11-11",
      producedBy: { id: "s", name: "Luz" },
      createdBy: null,
      createdAt: new Date(2026, 10, 11, 7, 5).toISOString(),
    } as ProductionBatch
    expect(batchesCsv([b])).toBe(
      "\uFEFFfecha;hora;preparacion;cantidad;unidad;lote;vence;bodega;responsable;costo_total\r\n" +
        "2026-11-11;07:05;Salsa roja;1,5;l;PB-1;2026-11-14;Cocina;Luz;2250\r\n",
    )
  })
})
