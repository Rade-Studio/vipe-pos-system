import { describe, expect, it } from "vitest"

import type { InventoryItem, PurchaseOrder } from "@/lib/supabase/inventory/types"
import {
  diffDraftLines,
  draftFromOrder,
  draftTotal,
  emptyDraft,
  entryUnit,
  hasDraftErrors,
  lineEntryCost,
  lineEntryQuantity,
  lineTotal,
  purchaseDraftReducer,
  toCreateInput,
  validateDraft,
  type PurchaseDraft,
} from "./purchase-draft"

const item = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: "i1",
  sku: "MP-0001",
  name: "Tomate",
  description: null,
  kind: "raw",
  unit: "kg",
  barcode: null,
  cost: 4000,
  stock: 0,
  minStock: 2,
  maxStock: 10,
  purchaseUnit: null,
  purchaseFactor: 1,
  defaultSupplierId: "s1",
  trackLots: false,
  shelfLifeDays: null,
  isActive: true,
  categoryId: null,
  categoryName: null,
  ...patch,
})

const tomato = item({})
const milk = item({ id: "i2", sku: "MP-0002", name: "Leche", unit: "l", cost: 3000, purchaseUnit: "caja", purchaseFactor: 12 })

const base = (): PurchaseDraft => ({ ...emptyDraft("l1"), supplierId: "s1" })

describe("purchaseDraftReducer", () => {
  it("adds an item with its last cost and a default quantity of one entry unit", () => {
    const s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0]).toMatchObject({ itemId: "i2", quantity: 12, unitCost: 3000 })
    expect(entryUnit(s.lines[0])).toBe("caja")
    expect(lineEntryQuantity(s.lines[0])).toBe(1)
    expect(lineEntryCost(s.lines[0])).toBe(36000)
  })

  it("adds an explicit base quantity and cost", () => {
    const s = purchaseDraftReducer(base(), { type: "addItem", item: tomato, quantity: 8, unitCost: 3500 })
    expect(s.lines[0]).toMatchObject({ quantity: 8, unitCost: 3500 })
    expect(entryUnit(s.lines[0])).toBe("kg")
  })

  it("adding an item already present sums the quantity instead of duplicating it", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    s = purchaseDraftReducer(s, { type: "addItem", item: milk })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0].quantity).toBe(24)
  })

  it("converts quantities and costs entered in purchase units to base units", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    const key = s.lines[0].key
    s = purchaseDraftReducer(s, { type: "setEntryQuantity", key, value: 2.5 })
    s = purchaseDraftReducer(s, { type: "setEntryCost", key, value: 30000 })
    expect(s.lines[0].quantity).toBe(30)
    expect(s.lines[0].unitCost).toBe(2500)
    expect(lineTotal(s.lines[0])).toBe(75000)
  })

  it("rounds the base unit cost to four decimals", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    s = purchaseDraftReducer(s, { type: "setEntryCost", key: s.lines[0].key, value: 10000 })
    expect(s.lines[0].unitCost).toBe(833.3333)
  })

  it("removes a line and sets header fields", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    s = purchaseDraftReducer(s, { type: "removeLine", key: s.lines[0].key })
    s = purchaseDraftReducer(s, { type: "setField", field: "notes", value: "Urgente" })
    expect(s.lines).toEqual([])
    expect(s.notes).toBe("Urgente")
  })

  it("resets to a given draft", () => {
    const next = { ...emptyDraft("l2") }
    expect(purchaseDraftReducer(base(), { type: "reset", draft: next })).toBe(next)
  })
})

describe("totals", () => {
  it("sums every line subtotal", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    s = purchaseDraftReducer(s, { type: "addItem", item: tomato, quantity: 2, unitCost: 4000 })
    expect(draftTotal(s)).toBe(36000 + 8000)
  })
})

describe("validateDraft", () => {
  it("requires supplier, location and at least one line, in Spanish", () => {
    const errors = validateDraft(emptyDraft(""))
    expect(errors.supplierId).toBe("Selecciona un proveedor")
    expect(errors.locationId).toBe("Selecciona la bodega de destino")
    expect(errors.lines).toBe("Agrega al menos un artículo")
    expect(hasDraftErrors(errors)).toBe(true)
  })

  it("flags lines with a non-positive quantity or a negative cost", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: tomato, quantity: 0, unitCost: -1 })
    const errors = validateDraft(s)
    expect(errors.lineErrors[s.lines[0].key]).toBe("La cantidad debe ser mayor que cero")
    s = purchaseDraftReducer(s, { type: "setEntryQuantity", key: s.lines[0].key, value: 1 })
    expect(validateDraft(s).lineErrors[s.lines[0].key]).toBe("El costo no puede ser negativo")
  })

  it("accepts a complete draft", () => {
    const s = purchaseDraftReducer(base(), { type: "addItem", item: tomato })
    expect(hasDraftErrors(validateDraft(s))).toBe(false)
  })
})

describe("toCreateInput", () => {
  it("emits base-unit lines and trims optional fields", () => {
    let s = purchaseDraftReducer(base(), { type: "addItem", item: milk })
    s = { ...s, notes: "  ", expectedOn: "2026-10-25" }
    expect(toCreateInput(s)).toEqual({
      supplierId: "s1",
      locationId: "l1",
      expectedOn: "2026-10-25",
      notes: null,
      lines: [{ itemId: "i2", quantity: 12, unitCost: 3000 }],
    })
  })
})

describe("draftFromOrder and diffDraftLines", () => {
  const order: PurchaseOrder = {
    id: "po1",
    number: 3,
    supplierId: "s1",
    supplierName: "Lácteos",
    locationId: "l1",
    locationName: "Bodega",
    status: "draft",
    expectedOn: null,
    paymentStatus: "pending",
    notes: "x",
    orderedAt: null,
    receivedAt: null,
    createdAt: "2026-10-19",
    lines: [
      { id: "L1", itemId: "i2", itemName: "Leche", sku: "MP-0002", unit: "l", quantity: 24, unitCost: 3000, receivedQuantity: 0, pendingQuantity: 24, total: 72000 },
      { id: "L2", itemId: "i1", itemName: "Tomate", sku: "MP-0001", unit: "kg", quantity: 5, unitCost: 4000, receivedQuantity: 0, pendingQuantity: 5, total: 20000 },
    ],
    total: 92000,
  }

  it("loads an order keeping the purchase unit of known items", () => {
    const s = draftFromOrder(order, [tomato, milk])
    expect(s.notes).toBe("x")
    expect(s.lines[0]).toMatchObject({ lineId: "L1", quantity: 24 })
    expect(lineEntryQuantity(s.lines[0])).toBe(2)
  })

  it("diffs added, updated and removed lines", () => {
    let s = draftFromOrder(order, [tomato, milk])
    s = purchaseDraftReducer(s, { type: "setEntryQuantity", key: s.lines[0].key, value: 3 })
    s = purchaseDraftReducer(s, { type: "removeLine", key: s.lines[1].key })
    s = purchaseDraftReducer(s, { type: "addItem", item: item({ id: "i3", name: "Sal", unit: "g", cost: 2 }), quantity: 500 })
    expect(diffDraftLines(order, s)).toEqual({
      add: [{ itemId: "i3", quantity: 500, unitCost: 2 }],
      update: [{ lineId: "L1", quantity: 36, unitCost: 3000 }],
      remove: ["L2"],
    })
  })
})
