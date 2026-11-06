/**
 * T24 — queue rows and the detail header carry the real folio (orderNumber),
 * guests and zone; the search finds a row by its folio.
 */
import { describe, expect, it } from "vitest"
import type { Order } from "@/types"
import { entryHeader, entryMeta, matchesQueueSearch, partialEntries, tableEntries } from "./queue"

const order = (over: Partial<Order> = {}): Order => ({
  id: "o-1",
  orderNumber: 128,
  guests: 4,
  tableId: "t-1",
  items: [],
  status: "delivered",
  bill: { subtotal: 1000, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 1000, totalDiscounts: 0 },
  waiter: "w-1",
  createdAt: new Date(2026, 10, 6, 13, 46),
  ...over,
})

const sources = (byTable: Record<string, Order[]>, partial: Order[] = []) => ({
  byTable,
  partial,
  tableNumberById: { "t-1": 12 },
  zoneNameByTableId: { "t-1": "Terraza" },
  waiterName: (id: string) => (id === "w-1" ? "Carlos Pérez" : undefined),
})

describe("queue rows (T24: folio, guests, zone)", () => {
  it("carries the folio, guests and zone of the table", () => {
    const [entry] = tableEntries(sources({ "t-1": [order()] }))
    expect(entry).toMatchObject({ orderNumbers: [128], guests: 4, zoneName: "Terraza", waiterName: "Carlos Pérez" })
    expect(entryMeta(entry!)).toBe("#128 · Terraza · Carlos Pérez · 4 personas · desde 13:46")
    expect(entryHeader(entry!)).toEqual({ eyebrow: "Orden #128 · Terraza", meta: "Carlos Pérez · abierta 13:46 · 4 personas" })
  })

  it("lists every folio of a table with several orders and keeps the largest guest count", () => {
    const [entry] = tableEntries(sources({ "t-1": [order(), order({ id: "o-2", orderNumber: 131, guests: 2 })] }))
    expect(entry!.orderNumbers).toEqual([128, 131])
    expect(entry!.guests).toBe(4)
    expect(entryHeader(entry!).eyebrow).toBe("2 órdenes · #128, #131 · Terraza")
  })

  it("leaves out what was not captured (no guests, no zone, no number)", () => {
    const [entry] = tableEntries({
      ...sources({ "t-1": [order({ orderNumber: undefined, guests: undefined })] }),
      zoneNameByTableId: {},
    })
    expect(entryMeta(entry!)).toBe("Carlos Pérez · desde 13:46")
    expect(entryHeader(entry!)).toEqual({ eyebrow: "Orden", meta: "Carlos Pérez · abierta 13:46" })
    expect(entry!.guests).toBeUndefined()
  })

  it("partials carry their own folio", () => {
    const [entry] = partialEntries(sources({}, [order({ id: "o-c", orderNumber: 140, isPartialOrder: true })]))
    expect(entry!.orderNumbers).toEqual([140])
    expect(entry!.zoneName).toBe("Terraza")
  })

  it("finds a row by its folio, with or without #", () => {
    const [entry] = tableEntries(sources({ "t-1": [order()] }))
    expect(matchesQueueSearch(entry!, "#128")).toBe(true)
    expect(matchesQueueSearch(entry!, "128")).toBe(true)
    expect(matchesQueueSearch(entry!, "terraza")).toBe(true)
    expect(matchesQueueSearch(entry!, "#999")).toBe(false)
  })
})

describe("waiter name (T24 review)", () => {
  it("prefers the order's waiterName and falls back to the profile lookup", () => {
    const [entry] = tableEntries(sources({ "t-1": [{ ...order(), waiterName: "Laura Ruiz" } as Order] }))
    expect(entry!.waiterName).toBe("Laura Ruiz")
    const [fallback] = tableEntries(sources({ "t-1": [order()] }))
    expect(fallback!.waiterName).toBe("Carlos Pérez")
  })
})
