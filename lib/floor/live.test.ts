import { describe, expect, it } from "vitest"

import type { Order } from "@/types"
import { elapsedLabel, openOrdersByTable } from "./live"

/** T22 (S8): what the waiter map derives from the open orders it already reads. */
describe("live floor details (T22)", () => {
  const now = new Date("2026-11-06T19:48:00Z")

  it("prints the time since the order opened: minutes, then hours and minutes", () => {
    expect(elapsedLabel(new Date("2026-11-06T19:30:00Z"), now)).toBe("18 min")
    expect(elapsedLabel(new Date("2026-11-06T19:47:59Z"), now)).toBe("0 min")
    expect(elapsedLabel(new Date("2026-11-06T18:43:00Z"), now)).toBe("1 h 05")
    // A clock a little ahead of this device never prints a negative time.
    expect(elapsedLabel(new Date("2026-11-06T19:50:00Z"), now)).toBe("0 min")
    expect(elapsedLabel(undefined, now)).toBeNull()
  })

  it("keeps the oldest open dine-in order of each table", () => {
    const order = (id: string, tableId: string, createdAt: string, status: Order["status"] = "kitchen") =>
      ({ id, tableId, createdAt: new Date(createdAt), status, items: [], waiter: "w-1" }) as unknown as Order
    const byTable = openOrdersByTable([
      order("o-2", "t-1", "2026-11-06T19:40:00Z"),
      order("o-1", "t-1", "2026-11-06T19:30:00Z", "delivered"),
      order("o-3", "t-2", "2026-11-06T19:00:00Z", "paid"),
      order("o-4", "", "2026-11-06T19:00:00Z"),
    ])
    expect([...byTable.entries()].map(([table, found]) => [table, found.id])).toEqual([["t-1", "o-1"]])
  })
})
