import { describe, expect, it } from "vitest"
import type { Order, Table } from "@/types"
import { elapsedMinutes, liveInfoByTable, longestWaiting, keepActiveFlag } from "./live"
import { requestEditorZone, takeEditorZone } from "./editor-zone"

/** T26 (S8) — the overview mini map: elapsed minutes and waiter from the open order. */

const NOW = new Date("2026-11-06T20:00:00Z")
const order = (id: string, tableId: string, minutesAgo: number, extra: Partial<Order & { waiterName?: string }> = {}) =>
  ({
    id,
    tableId,
    status: "kitchen",
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    items: [],
    bill: { subtotal: 0, tax: 0, tip: 0, total: 0 },
    waiter: "w-1",
    waiterName: "Camila Montoya",
    orderNumber: 41,
    ...extra,
  }) as Order & { waiterName?: string }

describe("elapsedMinutes", () => {
  it("counts whole minutes, never negative", () => {
    expect(elapsedMinutes(new Date(NOW.getTime() - 9 * 60_000 - 59_000), NOW)).toBe(9)
    expect(elapsedMinutes(new Date(NOW.getTime() + 60_000), NOW)).toBe(0)
  })
})

describe("liveInfoByTable", () => {
  it("takes the oldest open order of each table (splits and paid orders ignored)", () => {
    const info = liveInfoByTable(
      [
        order("o-2", "t-1", 5, { parentOrderId: "o-1" }),
        order("o-1", "t-1", 18),
        order("o-3", "t-2", 60, { status: "paid" }),
        order("o-4", "t-3", 3, { waiterName: "Desconocido" }),
      ],
      NOW,
    )
    expect(info.get("t-1")).toEqual({ minutes: 18, waiterName: "Camila Montoya", initials: "CM", orderNumber: 41 })
    expect(info.has("t-2")).toBe(false)
    expect(info.get("t-3")).toMatchObject({ minutes: 3, waiterName: undefined, initials: undefined })
  })
})

describe("open orders", () => {
  it("counts active (not yet sent), kitchen and delivered; never paid or cancelled", () => {
    const info = liveInfoByTable(
      [order("a", "t-1", 4, { status: "active" }), order("b", "t-2", 5, { status: "delivered" }), order("c", "t-3", 6, { status: "cancelled" })],
      NOW,
    )
    expect([...info.keys()].sort()).toEqual(["t-1", "t-2"])
    expect(info.get("t-1")?.minutes).toBe(4)
  })
})

describe("longestWaiting", () => {
  it("lists the three tables waiting longest", () => {
    const info = liveInfoByTable([order("a", "t-1", 5), order("b", "t-2", 30), order("c", "t-3", 12), order("d", "t-4", 1)], NOW)
    expect(longestWaiting(info, 3)).toEqual(["t-2", "t-3", "t-1"])
  })
})

describe("keepActiveFlag", () => {
  it("keeps a known isActive when a realtime row does not carry it", () => {
    const prev: Table[] = [{ id: "t-1", number: 1, status: "available", isActive: false }]
    const next: Table[] = [{ id: "t-1", number: 1, status: "occupied" }]
    expect(keepActiveFlag(prev, next, { id: "t-1" })[0]).toMatchObject({ status: "occupied", isActive: false })
    expect(keepActiveFlag(prev, next, { id: "t-1", is_active: true })[0].isActive).toBe(true)
  })
})

describe("editor zone hand-off", () => {
  it("Editar plano asks the editor for the zone shown, read once", () => {
    expect(takeEditorZone()).toBeNull()
    requestEditorZone("z-2")
    expect(takeEditorZone()).toBe("z-2")
    expect(takeEditorZone()).toBeNull()
  })
})
