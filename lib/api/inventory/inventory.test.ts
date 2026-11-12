import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"

/**
 * T10 (S3, S4) — the inventory services go through the typed API client
 * (`/api/inventory/...`) with the same exported names as the Supabase layer
 * they replace. Optional keys the caller did not give are omitted.
 */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  adjustStock,
  applyCount,
  cancelCount,
  checkDishesStock,
  checkStockForDish,
  checkStockForDishes,
  consumeOrderStock,
  createItem,
  createPreparation,
  createProductionTemplate,
  createPurchaseOrder,
  deleteCategory,
  deleteProductionTemplate,
  deletePurchaseOrder,
  getInventoryOverview,
  listBatches,
  listFormulas,
  listItems,
  listLocations,
  listLots,
  listMovements,
  listProductionTemplates,
  listPurchaseOrders,
  listSuppliers,
  openCount,
  producePreparation,
  producePreparations,
  receivePurchaseOrder,
  saveFormula,
  setCountedQuantity,
  setPurchaseOrderPaymentStatus,
  setPurchaseOrderStatus,
  transferStock,
  updateItem,
  updateProductionTemplate,
  updatePurchaseOrder,
} from "./index"

const D1 = "11111111-1111-4111-8111-111111111111"
const D2 = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: {} })
})

describe("items", () => {
  it("lists with only the given filters", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listItems()
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/items", { params: { query: {} } })
    await listItems({ kind: "prep", includeInactive: false })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/items", {
      params: { query: { kind: "prep", includeInactive: "false" } },
    })
  })

  it("creates the item and its opening stock in one request (null cost allowed)", async () => {
    api.POST.mockResolvedValue({ data: { id: "i-1" } })
    await createItem({ name: "Queso", unit: "kg", openingStock: { quantity: 5, unitCost: null } })
    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/inventory/items", {
      body: { name: "Queso", unit: "kg", openingStock: { quantity: 5, unitCost: null } },
    })
  })

  it("updates partially and creates preparations", async () => {
    await updateItem("i-1", { minStock: 2 })
    expect(api.PATCH).toHaveBeenCalledWith("/api/inventory/items/{id}", {
      params: { path: { id: "i-1" } },
      body: { minStock: 2 },
    })
    await createPreparation({ name: "Salsa", unit: "l" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/items/preparations", { body: { name: "Salsa", unit: "l" } })
  })

  it("deletes a category, lists locations and suppliers", async () => {
    await deleteCategory("c-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/inventory/item-categories/{id}", { params: { path: { id: "c-1" } } })
    api.GET.mockResolvedValue({ data: [] })
    await listLocations()
    await listSuppliers()
    expect(api.GET).toHaveBeenCalledWith("/api/inventory/locations")
    expect(api.GET).toHaveBeenCalledWith("/api/inventory/suppliers")
  })
})

describe("stock", () => {
  it("reads lots and pages of movements with comma-joined types", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listLots("i-1")
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/items/{id}/lots", { params: { path: { id: "i-1" } } })

    api.GET.mockResolvedValue({ data: { rows: [], total: 0 } })
    await expect(listMovements()).resolves.toEqual({ rows: [], total: 0 })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/movements", { params: { query: {} } })
    await listMovements({ itemId: "i-1", types: ["waste", "sale"], from: "2026-11-01", to: "2026-11-04", page: 2, pageSize: 25 })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/movements", {
      params: {
        query: { itemId: "i-1", types: "waste,sale", from: "2026-11-01", to: "2026-11-04", page: 2, pageSize: 25 },
      },
    })
  })

  it("adjusts and transfers with the camelCase input, omitting absent optionals", async () => {
    await adjustStock({ itemId: "i-1", locationId: "l-1", movementType: "waste", quantity: 1, lotId: "lot-1" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/movements/adjust", {
      body: { itemId: "i-1", locationId: "l-1", movementType: "waste", quantity: 1, lotId: "lot-1" },
    })
    await transferStock({ itemId: "i-1", fromLocationId: "l-1", toLocationId: "l-2", quantity: 3 })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/movements/transfer", {
      body: { itemId: "i-1", fromLocationId: "l-1", toLocationId: "l-2", quantity: 3 },
    })
  })
})

describe("purchasing", () => {
  it("lists with comma-joined statuses", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listPurchaseOrders({ status: ["draft", "ordered"], supplierId: "s-1" })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/purchase-orders", {
      params: { query: { status: "draft,ordered", supplierId: "s-1" } },
    })
  })

  it("creates header and lines in one request and saves an edit in one PUT", async () => {
    const lines = [{ itemId: "i-1", quantity: 2, unitCost: 100 }]
    await createPurchaseOrder({ supplierId: "s-1", locationId: "l-1", lines })
    expect(api.POST).toHaveBeenCalledWith("/api/inventory/purchase-orders", {
      body: { supplierId: "s-1", locationId: "l-1", lines },
    })
    await updatePurchaseOrder("po-1", {
      supplierId: "s-1",
      locationId: "l-1",
      expectedOn: null,
      notes: null,
      lines: [{ lineId: "L1", itemId: "i-1", quantity: 3, unitCost: 100 }, { itemId: "i-2", quantity: 1, unitCost: 5 }],
    })
    expect(api.PUT).toHaveBeenCalledWith("/api/inventory/purchase-orders/{id}", {
      params: { path: { id: "po-1" } },
      body: {
        supplierId: "s-1",
        locationId: "l-1",
        expectedOn: null,
        notes: null,
        lines: [{ lineId: "L1", itemId: "i-1", quantity: 3, unitCost: 100 }, { itemId: "i-2", quantity: 1, unitCost: 5 }],
      },
    })
  })

  it("sets status and payment status, deletes drafts", async () => {
    await setPurchaseOrderStatus("po-1", "ordered")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/purchase-orders/{id}/status", {
      params: { path: { id: "po-1" } },
      body: { status: "ordered" },
    })
    await setPurchaseOrderPaymentStatus("po-1", "paid")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/purchase-orders/{id}/payment-status", {
      params: { path: { id: "po-1" } },
      body: { paymentStatus: "paid" },
    })
    await deletePurchaseOrder("po-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/inventory/purchase-orders/{id}", { params: { path: { id: "po-1" } } })
  })

  it("receives with the payment status in the same request, omitting it when absent", async () => {
    await receivePurchaseOrder("po-1", [{ lineId: "L1", quantity: 2, lotCode: "R1" }], "paid")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/purchase-orders/{id}/receive", {
      params: { path: { id: "po-1" } },
      body: { lines: [{ lineId: "L1", quantity: 2, lotCode: "R1" }], paymentStatus: "paid" },
    })
    await receivePurchaseOrder("po-1", [{ lineId: "L1", quantity: 2 }])
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/purchase-orders/{id}/receive", {
      params: { path: { id: "po-1" } },
      body: { lines: [{ lineId: "L1", quantity: 2 }] },
    })
  })
})

describe("production, counts, formulas, overview", () => {
  it("produces and lists batches", async () => {
    await producePreparation({ itemId: "p-1", quantity: 4 })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/production", { body: { itemId: "p-1", quantity: 4 } })
    api.GET.mockResolvedValue({ data: [] })
    await listBatches({ itemId: "p-1", limit: 10 })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/batches", { params: { query: { itemId: "p-1", limit: 10 } } })
  })

  it("produces a daily report in bulk with a business date and a responsible person", async () => {
    await producePreparation({ itemId: "p-1", quantity: 1, producedOn: "2026-11-10", producedBy: "u-1" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/production", {
      body: { itemId: "p-1", quantity: 1, producedOn: "2026-11-10", producedBy: "u-1" },
    })
    await producePreparations({ lines: [{ itemId: "p-1", quantity: 2 }, { itemId: "p-2", quantity: 1, lotCode: "L" }], producedOn: "2026-11-10" })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/production/bulk", {
      body: { lines: [{ itemId: "p-1", quantity: 2 }, { itemId: "p-2", quantity: 1, lotCode: "L" }], producedOn: "2026-11-10" },
    })
  })

  it("lists batches by produced_on range", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listBatches({ from: "2026-11-01", to: "2026-11-07" })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/batches", { params: { query: { from: "2026-11-01", to: "2026-11-07" } } })
  })

  it("lists, creates, updates and deletes production templates", async () => {
    api.GET.mockResolvedValue({ data: [] })
    expect(await listProductionTemplates()).toEqual([])
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/production-templates")
    const lines = [{ itemId: "p-1", quantity: 2 }]
    await createProductionTemplate({ name: "Lunes", lines })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/production-templates", { body: { name: "Lunes", lines } })
    await updateProductionTemplate("t-1", { name: "Martes" })
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/inventory/production-templates/{id}", {
      params: { path: { id: "t-1" } },
      body: { name: "Martes" },
    })
    await deleteProductionTemplate("t-1")
    expect(api.DELETE).toHaveBeenLastCalledWith("/api/inventory/production-templates/{id}", { params: { path: { id: "t-1" } } })
  })

  it("opens, counts a line by count id, applies and cancels", async () => {
    await openCount()
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts", { body: {} })
    await setCountedQuantity("cnt-1", "line-1", null)
    expect(api.PATCH).toHaveBeenCalledWith("/api/inventory/counts/{id}/lines/{lineId}", {
      params: { path: { id: "cnt-1", lineId: "line-1" } },
      body: { countedQuantity: null },
    })
    await applyCount("cnt-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/apply", { params: { path: { id: "cnt-1" } } })
    await cancelCount("cnt-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/cancel", { params: { path: { id: "cnt-1" } } })
  })

  it("reads formulas with the server unit cost and saves through PUT", async () => {
    const index = { byDish: {}, byPrep: { "p-1": { recipeId: "r", targetType: "prep", targetId: "p-1", yieldQuantity: 2, notes: null, lines: [], unitCost: 12.5 } } }
    api.GET.mockResolvedValue({ data: index })
    await expect(listFormulas()).resolves.toEqual(index)
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/formulas")
    await saveFormula({ targetType: "dish", targetId: D1, yieldQuantity: 1, lines: [{ ingredientId: "i-1", quantity: 2 }] })
    expect(api.PUT).toHaveBeenCalledWith("/api/inventory/formulas", {
      body: { targetType: "dish", targetId: D1, yieldQuantity: 1, lines: [{ ingredientId: "i-1", quantity: 2 }] },
    })
  })

  it("reads the overview for the given days", async () => {
    await getInventoryOverview(7)
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/overview", { params: { query: { days: 7 } } })
  })
})

describe("sales and dish availability", () => {
  it("checks and consumes stock", async () => {
    await checkDishesStock([{ dishId: D1, quantity: 2 }])
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/check-stock", { body: { items: [{ dishId: D1, quantity: 2 }] } })
    await consumeOrderStock("o-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/consume", { body: { orderId: "o-1" } })
  })

  it("asks the server once for every valid dish id and returns a Map", async () => {
    api.POST.mockResolvedValue({ data: { [D1]: false, [D2]: true } })
    const result = await checkStockForDishes([D1, D2, D1, "not-a-uuid"])
    expect(api.POST).toHaveBeenCalledTimes(1)
    expect(api.POST).toHaveBeenCalledWith("/api/inventory/dish-availability", { body: { dishIds: [D1, D2] } })
    expect(result).toEqual(new Map([[D1, false], [D2, true]]))
  })

  it("does not call the API without ids; an id missing from the answer is not marked unavailable", async () => {
    await expect(checkStockForDishes([])).resolves.toEqual(new Map())
    expect(api.POST).not.toHaveBeenCalled()
    api.POST.mockResolvedValue({ data: {} })
    const result = await checkStockForDishes([D1])
    expect(result.get(D1)).not.toBe(false)
  })

  it("checkStockForDish answers one dish, available when unknown", async () => {
    api.POST.mockResolvedValue({ data: { [D1]: false } })
    await expect(checkStockForDish(D1)).resolves.toBe(false)
    api.POST.mockResolvedValue({ data: {} })
    await expect(checkStockForDish(D2)).resolves.toBe(true)
  })

  it("passes the API error through", async () => {
    api.POST.mockRejectedValue(new ApiError(403, "Forbidden", "Forbidden resource"))
    await expect(checkStockForDishes([D1])).rejects.toMatchObject({ status: 403 })
  })
})
