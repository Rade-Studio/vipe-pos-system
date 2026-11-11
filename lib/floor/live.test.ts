import { describe, expect, it } from "vitest"

import type { Order } from "@/types"
import { OLD_ORDER_HOURS, elapsedLabel, isOldElapsed, isOldOrder, openOrdersByTable } from "./live"

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

  const hoursAgo = (h: number, m = 0) => new Date(now.getTime() - (h * 60 + m) * 60_000)

  it("S3: prints days past 24 h instead of unbounded hours", () => {
    expect(elapsedLabel(hoursAgo(2, 5), now)).toBe("2 h 05")
    expect(elapsedLabel(hoursAgo(23, 59), now)).toBe("23 h 59")
    expect(elapsedLabel(hoursAgo(24), now)).toBe("1 d 0 h")
    expect(elapsedLabel(hoursAgo(145, 27), now)).toBe("6 d 1 h")
  })

  it("S3: an order open 12 h or more is old", () => {
    expect(OLD_ORDER_HOURS).toBe(12)
    expect(isOldOrder(hoursAgo(11, 59), now)).toBe(false)
    expect(isOldOrder(hoursAgo(12), now)).toBe(true)
    expect(isOldOrder(undefined, now)).toBe(false)
    expect(isOldElapsed("11 h 59")).toBe(false)
    expect(isOldElapsed("12 h 00")).toBe(true)
    expect(isOldElapsed("6 d 1 h")).toBe(true)
    expect(isOldElapsed("18 min")).toBe(false)
    expect(isOldElapsed(null)).toBe(false)
  })
})
