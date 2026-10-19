import { beforeEach, describe, expect, it, vi } from "vitest"

// Records the payload of every insert so the test can read what reached
// `order_items` without a database.
const inserts: Record<string, unknown[]> = {}

vi.mock("./client", () => {
  const from = (table: string) => ({
    insert: (payload: unknown) => {
      ;(inserts[table] ??= []).push(payload)
      const result = { data: table === "orders" ? [{ id: "order-1" }] : null, error: null }
      return { ...Promise.resolve(result), then: Promise.resolve(result).then.bind(Promise.resolve(result)), select: async () => result }
    },
    delete: () => ({ eq: async () => ({ error: null }) }),
  })
  return { supabase: { from } }
})

const DISH = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b"

describe("orderService.create — order_items.dish_id", () => {
  beforeEach(() => {
    for (const key of Object.keys(inserts)) delete inserts[key]
  })

  it("stores the dish uuid behind each cart id so the stock RPC can find its formula", async () => {
    const { orderService } = await import("./service")

    await orderService.create({
      table_id: "t-1",
      waiter_id: "w-1",
      subtotal: 30000,
      tax: 0,
      tax_percentage: 0,
      tip: 0,
      tip_percentage: 0,
      total: 30000,
      items: [
        { id: `${DISH}-1729350000000`, name: "Burger", price: 15000, quantity: 1 },
        { id: DISH, name: "Burger", price: 15000, quantity: 1 },
        { id: "item-42", name: "Libre", price: 0, quantity: 1 },
      ],
    } as never)

    const rows = inserts.order_items?.[0] as { dish_id: string | null }[]
    expect(rows.map((row) => row.dish_id)).toEqual([DISH, DISH, null])
  })
})
