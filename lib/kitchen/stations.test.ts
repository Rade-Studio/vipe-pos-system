import { describe, expect, it } from "vitest"
import type { Order } from "@/types"
import { orderForStation, ordersForStation, readKitchenStation, writeKitchenStation, KITCHEN_STATION_KEY } from "./stations"

/** F6 — the kitchen screen of one station: only its lines, remembered per device. */

const item = (id: string, stationId: string | undefined, status: "kitchen" | "served" = "kitchen") =>
  ({ id, name: id, price: 1, quantity: 1, categoryId: "", image: "", status, stationId }) as Order["items"][number]

const order = (id: string, items: Order["items"]): Order =>
  ({ id, tableId: "t", items, status: "kitchen", waiter: "w", createdAt: new Date(0) }) as Order

const orders = [
  order("o-1", [item("bandeja", "cocina"), item("lulo", "barra")]),
  order("o-2", [item("jugo", "barra", "served"), item("ajiaco", "cocina")]),
  order("o-3", [item("old", undefined)]),
]

describe("ordersForStation", () => {
  it("keeps every order for Todas (null) and returns the same array", () => {
    expect(ordersForStation(orders, null)).toBe(orders)
  })

  it("keeps only the orders with a pending line of the station, each with only its lines", () => {
    const bar = ordersForStation(orders, "barra")
    expect(bar.map((o) => [o.id, o.items.map((i) => i.id)])).toEqual([["o-1", ["lulo"]]])
    const kitchen = ordersForStation(orders, "cocina")
    expect(kitchen.map((o) => [o.id, o.items.map((i) => i.id)])).toEqual([
      ["o-1", ["bandeja"]],
      ["o-2", ["ajiaco"]],
    ])
  })

  it("leaves lines sent before the stations only under Todas", () => {
    expect(ordersForStation(orders, "cocina").some((o) => o.id === "o-3")).toBe(false)
    expect(orderForStation(orders[2], "cocina")).toBeNull()
    expect(orderForStation(orders[0], null)).toBe(orders[0])
  })
})

describe("remembered station", () => {
  const memory = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }
  }

  it("reads null until a station is chosen on this device, then that station", () => {
    const storage = memory()
    expect(readKitchenStation(storage)).toBeNull()
    writeKitchenStation("barra", storage)
    expect(storage.getItem(KITCHEN_STATION_KEY)).toBe("barra")
    expect(readKitchenStation(storage)).toBe("barra")
    writeKitchenStation(null, storage)
    expect(readKitchenStation(storage)).toBeNull()
  })

  it("never throws without storage (private mode, server render)", () => {
    const broken = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("denied") }, removeItem: () => {} }
    expect(readKitchenStation(broken)).toBeNull()
    expect(() => writeKitchenStation("barra", broken)).not.toThrow()
    expect(readKitchenStation(undefined)).toBeNull()
  })
})
