import { describe, expect, it } from "vitest"

import type { Movement } from "@/lib/api/inventory/types"
import { documentSection, documentText, groupMovementsByDay, MOVEMENT_GROUPS, movementsCsv } from "./movements"

const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 5).toISOString()

const move = (patch: Partial<Movement>): Movement => ({
  id: "m1",
  itemId: "i1",
  itemName: "Pechuga de pollo",
  sku: "MP-0004",
  unit: "kg",
  locationId: "l1",
  locationName: "Sede Norte",
  lotId: null,
  movementType: "transfer_in",
  quantity: 8,
  unitCost: 17750,
  totalCost: 142000,
  reason: null,
  notes: null,
  referenceType: "inventory_transfer",
  referenceId: "t7",
  createdBy: "p1",
  createdByName: "Mariana R.",
  documentKind: "inventory_transfer",
  documentId: "t7",
  documentLabel: "TR-0007",
  createdAt: at(12, 11),
  ...patch,
})

describe("movement groups", () => {
  it("maps each chip to the server types, adjustments with counts and opening", () => {
    expect(Object.fromEntries(MOVEMENT_GROUPS.map((g) => [g.label, g.types]))).toEqual({
      Ventas: ["sale"],
      Compras: ["purchase"],
      Producción: ["production_consume", "production_output"],
      "Ajustes y conteos": ["adjustment", "count_adjustment", "opening"],
      Mermas: ["waste"],
      Traslados: ["transfer_out", "transfer_in"],
    })
  })
})

describe("documentText", () => {
  it("shows the document label, and names a transfer shortfall as merma en tránsito", () => {
    expect(documentText(move({}))).toBe("TR-0007")
    expect(documentText(move({ movementType: "waste", quantity: -1 }))).toBe("Merma en tránsito · TR-0007")
    expect(documentText(move({ documentKind: null, documentId: null, documentLabel: null }))).toBeNull()
  })
})

describe("documentSection", () => {
  it("opens the screen of each document kind", () => {
    expect(documentSection("order")).toBe("orders")
    expect(documentSection("purchase_order")).toBe("inventory/purchases")
    expect(documentSection("inventory_count")).toBe("inventory/counts")
    expect(documentSection("production_batch")).toBe("inventory/production")
    expect(documentSection(null)).toBeNull()
  })
})

describe("groupMovementsByDay", () => {
  it("groups by local day, newest first, with the day's net value", () => {
    const groups = groupMovementsByDay([
      move({ id: "a", createdAt: at(12, 11), totalCost: 142000 }),
      move({ id: "b", createdAt: at(12, 9), totalCost: -9200 }),
      move({ id: "c", createdAt: at(11, 21), totalCost: -608 }),
    ])
    expect(groups.map((g) => [g.day, g.rows.map((m) => m.id), g.net])).toEqual([
      ["2026-11-12", ["a", "b"], 132800],
      ["2026-11-11", ["c"], -608],
    ])
  })
})

describe("movementsCsv", () => {
  it("exports the origin and the author with `;` and a BOM", () => {
    const csv = movementsCsv([move({ movementType: "waste", quantity: -1.5, totalCost: -26625, reason: "Bolsa rota" })])
    const [header, row] = csv.replace(/^\uFEFF/, "").trim().split("\r\n")
    expect(header).toBe("fecha;hora;sku;articulo;bodega;tipo;cantidad;unidad;costo_unitario;costo_total;origen;motivo;usuario")
    expect(row).toBe("2026-11-12;11:05;MP-0004;Pechuga de pollo;Sede Norte;Merma;-1,5;kg;17750;-26625;Merma en tránsito · TR-0007;Bolsa rota;Mariana R.")
  })
})
