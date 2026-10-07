/**
 * T7 — the kitchen row -> `Order` mapping, extracted from the view so both the
 * hydration read and the realtime batch read share it (one mapping, one read).
 *
 * Delivery invariant (odd/tasks/domicilios.md S13/S14): a delivery order keeps
 * `orderType: 'delivery'` so the DOMICILIO banner and heading never fall back
 * to "Mesa ?", and an order with no kitchen items never reaches the queue.
 *
 * RED target: `lib/kitchen/order.ts` does not exist yet.
 */
import { describe, expect, it } from "vitest"
import { kitchenOrderFromRow, kitchenOrdersFromRows, type DbOrderRow } from "./order"

function item(id: string, status: "kitchen" | "served", createdAt: string) {
  return {
    id,
    order_id: "o-1",
    dish_id: null,
    name: `Item ${id}`,
    price: 100,
    quantity: 1,
    comments: null,
    status,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

function row(overrides: Record<string, unknown> = {}, items: unknown[] | null = []): DbOrderRow {
  return {
    id: "o-1",
    table_id: "t-1",
    order_type: "dine_in",
    waiter_id: "w-1",
    status: "kitchen",
    subtotal: 100,
    tax: 0,
    tax_percentage: 0,
    tip: 0,
    tip_percentage: 0,
    total: 100,
    total_discounts: 0,
    is_partial_order: false,
    parent_order_id: null,
    created_at: "2026-10-07T11:00:00.000Z",
    updated_at: "2026-10-07T11:00:00.000Z",
    order_items: items,
    ...overrides,
    items_json: [],
    restaurant_id: "rest-1",
  } as unknown as DbOrderRow
}

describe("kitchenOrderFromRow", () => {
  it("keeps only the kitchen items, oldest first", () => {
    const mapped = kitchenOrderFromRow(
      row({}, [
        item("i-2", "kitchen", "2026-10-07T11:02:00.000Z"),
        item("i-3", "served", "2026-10-07T11:03:00.000Z"),
        item("i-1", "kitchen", "2026-10-07T11:01:00.000Z"),
      ]),
    )

    expect(mapped?.items.map((i) => i.id)).toEqual(["i-1", "i-2"])
    expect(mapped?.items[0].status).toBe("kitchen")
    expect(mapped?.items[0].addedAt).toEqual(new Date("2026-10-07T11:01:00.000Z"))
  })

  it("returns null when no item is in the kitchen", () => {
    expect(kitchenOrderFromRow(row({}, [item("i-1", "served", "2026-10-07T11:01:00.000Z")]))).toBeNull()
    expect(kitchenOrderFromRow(row({}, []))).toBeNull()
    expect(kitchenOrderFromRow(row({}, null))).toBeNull()
  })

  it("keeps a delivery order a delivery (DOMICILIO banner, never 'Mesa ?')", () => {
    const mapped = kitchenOrderFromRow(
      row({ order_type: "delivery", table_id: null }, [item("i-1", "kitchen", "2026-10-07T11:01:00.000Z")]),
    )

    expect(mapped?.orderType).toBe("delivery")
    expect(mapped?.tableId).toBe("")
  })

  it("maps the bill, waiter and timestamps", () => {
    const mapped = kitchenOrderFromRow(
      row({ subtotal: 200, tax: 38, tax_percentage: 19, tip: 20, tip_percentage: 10, total: 258 }, [
        item("i-1", "kitchen", "2026-10-07T11:01:00.000Z"),
      ]),
    )

    expect(mapped?.bill).toEqual({
      subtotal: 200,
      tax: 38,
      taxPercentage: 19,
      tip: 20,
      tipPercentage: 10,
      total: 258,
      totalDiscounts: 0,
    })
    expect(mapped?.waiter).toBe("w-1")
    expect(mapped?.status).toBe("kitchen")
    expect(mapped?.createdAt).toEqual(new Date("2026-10-07T11:00:00.000Z"))
    expect(mapped?.isPartialOrder).toBe(false)
  })
})

describe("kitchenOrdersFromRows", () => {
  it("maps the rows it can and skips the ones with nothing in the kitchen", () => {
    const mapped = kitchenOrdersFromRows([
      row({}, [item("i-1", "kitchen", "2026-10-07T11:01:00.000Z")]),
      row({ id: "o-2" }, [item("i-2", "served", "2026-10-07T11:02:00.000Z")]),
    ])

    expect(mapped.map((o) => o.id)).toEqual(["o-1"])
  })

  it("tolerates a missing order_items relation", () => {
    const { order_items: _ignored, ...withoutItems } = row() as Record<string, unknown>

    expect(kitchenOrdersFromRows([withoutItems as unknown as DbOrderRow])).toEqual([])
  })
})