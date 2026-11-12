import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

import { emptyItemForm, toInput, toOpening } from "@/lib/inventory/item-form"
import { draftFromOrder, emptyDraft, purchaseDraftReducer, toCreateInput, toUpdateInput } from "@/lib/inventory/purchase-draft"

/**
 * The API's zod schemas, loaded at runtime: a literal import would pull the
 * Nest DTO classes (decorators) into the web `tsc`, whose tsconfig has no
 * `experimentalDecorators`. Read-only; the root Vitest config resolves it.
 */
const DTO_MODULE = "../../../apps/api/src/inventory/inventory.dto"
let dto: Record<string, ZodType>
beforeAll(async () => {
  dto = (await import(/* @vite-ignore */ DTO_MODULE)) as Record<string, ZodType>
})

/**
 * T10 (S3) — web/API body drift: every body the services send, built the way
 * the screens build it, is accepted by the API's own zod schema (read-only
 * import of `apps/api/src/inventory/inventory.dto.ts`).
 */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  adjustStock,
  createItem,
  createProductionTemplate,
  createPurchaseOrder,
  createSupplier,
  openCount,
  producePreparation,
  producePreparations,
  receivePurchaseOrder,
  saveFormula,
  setCountedQuantity,
  transferStock,
  updateProductionTemplate,
  updatePurchaseOrder,
} from "./index"
import type { InventoryItem, PurchaseOrder } from "./types"

const ITEM = "11111111-1111-4111-8111-111111111111"
const ITEM2 = "22222222-2222-4222-8222-222222222222"
const LOC = "33333333-3333-4333-8333-333333333333"
const LOC2 = "44444444-4444-4444-8444-444444444444"
const SUP = "55555555-5555-4555-8555-555555555555"
const LINE = "66666666-6666-4666-8666-666666666666"
const LOT = "77777777-7777-4777-8777-777777777777"

/** The body of the last call of `method`, as it goes on the wire. */
const sent = (method: keyof typeof api): unknown => {
  const calls = api[method].mock.calls
  return JSON.parse(JSON.stringify(calls[calls.length - 1][1].body))
}

/** `name` is the export of the API DTO module, e.g. `createItemSchema`. */
const accepts = (name: string, body: unknown) => {
  const schema = dto[name]
  expect(schema, name).toBeDefined()
  const result = schema.safeParse(body)
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
}

const item = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: ITEM, sku: "MP-0001", name: "Leche", description: null, kind: "raw", unit: "l", barcode: null, cost: 3000, stock: 0,
  minStock: 0, maxStock: null, purchaseUnit: "caja", purchaseFactor: 12, defaultSupplierId: null, trackLots: false,
  shelfLifeDays: null, isActive: true, categoryId: null, categoryName: null, ...patch,
})

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: {} })
})

describe("bodies the API accepts", () => {
  it("item create with an opening stock and a blank cost", async () => {
    const values = { ...emptyItemForm(), name: "Queso", unit: "kg", initialStock: "5", initialCost: "" }
    const opening = toOpening(values)
    expect(opening).toEqual({ quantity: 5, unitCost: null })
    await createItem({ ...toInput(values), ...(opening ? { openingStock: opening } : {}) })
    accepts("createItemSchema", sent("POST"))
  })

  it("purchase order create and full-draft update", async () => {
    let draft = { ...emptyDraft(LOC), supplierId: SUP }
    draft = purchaseDraftReducer(draft, { type: "addItem", item: item({}) })
    await createPurchaseOrder(toCreateInput(draft))
    accepts("createPurchaseOrderSchema", sent("POST"))

    const order: PurchaseOrder = {
      id: "po", number: 1, supplierId: SUP, supplierName: null, locationId: LOC, locationName: null, status: "draft",
      expectedOn: null, paymentStatus: "pending", notes: null, orderedAt: null, receivedAt: null, createdAt: "c", total: 0,
      lines: [{ id: LINE, itemId: ITEM, itemName: "Leche", sku: "MP-0001", unit: "l", quantity: 24, unitCost: 3000, receivedQuantity: 0, pendingQuantity: 24, total: 0 }],
    }
    let edit = draftFromOrder(order, [item({})])
    edit = purchaseDraftReducer(edit, { type: "addItem", item: item({ id: ITEM2, purchaseUnit: null, purchaseFactor: 1 }) })
    await updatePurchaseOrder("po", toUpdateInput(edit))
    accepts("updatePurchaseOrderSchema", sent("PUT"))
  })

  it("receive lines with the payment status", async () => {
    await receivePurchaseOrder("po", [{ lineId: LINE, quantity: 3, unitCost: 21000, lotCode: "Q-1", expiresOn: "2026-11-30" }, { lineId: LINE, quantity: 1 }], "paid")
    accepts("receivePurchaseOrderSchema", sent("POST"))
  })

  it("daily production and templates", async () => {
    await producePreparation({ itemId: ITEM, quantity: 1, producedOn: "2026-11-10", producedBy: LOT })
    accepts("producePreparationSchema", sent("POST"))
    await producePreparations({
      lines: [{ itemId: ITEM, quantity: 2 }, { itemId: ITEM2, quantity: 0.5, lotCode: null }],
      locationId: LOC, producedOn: "2026-11-10", producedBy: LOT, notes: null,
    })
    accepts("bulkProduceSchema", sent("POST"))
    await createProductionTemplate({ name: "Lunes", lines: [{ itemId: ITEM, quantity: 2 }] })
    accepts("createProductionTemplateSchema", sent("POST"))
    await updateProductionTemplate("t", { lines: [{ itemId: ITEM2, quantity: 1 }] })
    accepts("updateProductionTemplateSchema", sent("PATCH"))
  })

  it("adjust, transfer and produce", async () => {
    await adjustStock({ itemId: ITEM, locationId: LOC, movementType: "waste", quantity: 2, reason: "vencido", lotId: LOT })
    accepts("adjustStockSchema", sent("POST"))
    await transferStock({ itemId: ITEM, fromLocationId: LOC, toLocationId: LOC2, quantity: 1, notes: null })
    accepts("transferStockSchema", sent("POST"))
    await producePreparation({ itemId: ITEM, quantity: 4, locationId: null, lotCode: null, notes: null })
    accepts("producePreparationSchema", sent("POST"))
  })

  it("counts: open and a counted line (also cleared)", async () => {
    await openCount({ locationId: LOC, itemIds: [ITEM] })
    accepts("openCountSchema", sent("POST"))
    await openCount()
    accepts("openCountSchema", sent("POST"))
    await setCountedQuantity("c", LINE, 4.5)
    accepts("countLineSchema", sent("PATCH"))
    await setCountedQuantity("c", LINE, null)
    accepts("countLineSchema", sent("PATCH"))
  })

  it("save formula and create supplier", async () => {
    await saveFormula({ targetType: "prep", targetId: ITEM, yieldQuantity: 500, lines: [{ ingredientId: ITEM2, quantity: 50 }], notes: null })
    accepts("saveFormulaSchema", sent("PUT"))
    await createSupplier({ name: "Lácteos", taxId: "900123", contactName: null, phone: null, email: null, leadTimeDays: 3, notes: null })
    accepts("createSupplierSchema", sent("POST"))
  })
})
