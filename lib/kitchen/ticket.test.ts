import { describe, expect, it } from "vitest"
import type { Order } from "@/types"
import {
  AT_RISK_FROM_MINUTES,
  LATE_FROM_MINUTES,
  countByKind,
  formatElapsed,
  matchesKindFilter,
  oldestFirst,
  ticketAge,
  ticketStartedAt,
} from "@/lib/kitchen/ticket"

const order = (id: string, options: { addedAt?: string[]; createdAt?: string; orderType?: Order["orderType"] } = {}): Order =>
  ({
    id,
    tableId: "t",
    orderType: options.orderType ?? "dine_in",
    waiter: "w",
    status: "kitchen",
    createdAt: new Date(options.createdAt ?? "2026-10-07T11:00:00.000Z"),
    bill: {} as Order["bill"],
    items: (options.addedAt ?? []).map((at, index) => ({
      id: `${id}-${index}`,
      name: "x",
      price: 1,
      quantity: 1,
      categoryId: "c",
      image: "",
      status: "kitchen",
      addedAt: new Date(at),
    })),
  }) as Order

describe("ticket age", () => {
  it("keeps the design thresholds as named constants", () => {
    expect(AT_RISK_FROM_MINUTES).toBe(15)
    expect(LATE_FROM_MINUTES).toBe(25)
  })

  it("labels 0-14 min on time, 15-24 at risk and 25+ late", () => {
    const min = 60_000
    expect(ticketAge(0)).toEqual({ tone: "ok", label: "A tiempo", minutes: 0 })
    expect(ticketAge(14 * min + 59_000)).toEqual({ tone: "ok", label: "A tiempo", minutes: 14 })
    expect(ticketAge(15 * min)).toEqual({ tone: "risk", label: "En riesgo", minutes: 15 })
    expect(ticketAge(24 * min + 59_000)).toEqual({ tone: "risk", label: "En riesgo", minutes: 24 })
    expect(ticketAge(25 * min)).toEqual({ tone: "late", label: "Atrasada", minutes: 25 })
    expect(ticketAge(-5_000)).toEqual({ tone: "ok", label: "A tiempo", minutes: 0 })
  })

  it("formats the elapsed time as mm:ss, past the hour too", () => {
    expect(formatElapsed(0)).toBe("00:00")
    expect(formatElapsed(65_000)).toBe("01:05")
    expect(formatElapsed(27 * 60_000 + 12_000)).toBe("27:12")
    expect(formatElapsed(61 * 60_000 + 1_000)).toBe("61:01")
    expect(formatElapsed(-1)).toBe("00:00")
  })
})

describe("ticket start and rail order", () => {
  it("starts at the oldest kitchen item, or the order creation without items", () => {
    expect(ticketStartedAt(order("a", { addedAt: ["2026-10-07T11:05:00Z", "2026-10-07T11:02:00Z"] }))).toBe(
      Date.parse("2026-10-07T11:02:00Z"),
    )
    expect(ticketStartedAt(order("b", { createdAt: "2026-10-07T10:00:00Z" }))).toBe(Date.parse("2026-10-07T10:00:00Z"))
  })

  it("orders the rail oldest first without mutating the input", () => {
    const input = [
      order("new", { addedAt: ["2026-10-07T11:30:00Z"] }),
      order("old", { addedAt: ["2026-10-07T11:00:00Z"] }),
    ]
    expect(oldestFirst(input).map((o) => o.id)).toEqual(["old", "new"])
    expect(input.map((o) => o.id)).toEqual(["new", "old"])
  })
})

describe("kind filter", () => {
  const orders = [order("m1"), order("m2"), order("d1", { orderType: "delivery" })]

  it("counts every order, the tables and the deliveries", () => {
    expect(countByKind(orders)).toEqual({ all: 3, dine_in: 2, delivery: 1 })
  })

  it("matches all, only tables or only deliveries", () => {
    expect(orders.filter((o) => matchesKindFilter(o, "all")).map((o) => o.id)).toEqual(["m1", "m2", "d1"])
    expect(orders.filter((o) => matchesKindFilter(o, "dine_in")).map((o) => o.id)).toEqual(["m1", "m2"])
    expect(orders.filter((o) => matchesKindFilter(o, "delivery")).map((o) => o.id)).toEqual(["d1"])
  })
})
