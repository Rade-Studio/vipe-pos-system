import { describe, expect, it } from "vitest"
import type { Table } from "@/types"
import { alertIconKind, alertText, matchTableAlerts } from "./alerts"

/** ux-carta-mesero S4: carta inbox items land on their table (zone name + number). */
const tables: Table[] = [
  { id: "t-terraza-12", number: 12, status: "occupied", zoneId: "z-t" },
  { id: "t-salon-12", number: 12, status: "occupied", zoneId: "z-s" },
  { id: "t-salon-5", number: 5, status: "occupied", zoneId: "z-s" },
]
const zoneNameOf = (zoneId?: string) => ({ "z-t": "Terraza", "z-s": "Salón" })[zoneId ?? ""]
const base = { orderId: "o", waiterName: null, createdAt: "2026-11-12T13:05:00.000Z" }
const proposal = (tableNumber: number, zoneName: string | null) =>
  ({ ...base, id: `p-${tableNumber}-${zoneName}`, tableNumber, zoneName, note: null, lines: [] }) as never
const request = (kind: "bill" | "waiter", tableNumber: number, zoneName: string | null) =>
  ({ ...base, id: `r-${kind}-${tableNumber}`, kind, tableNumber, zoneName }) as never

describe("matchTableAlerts", () => {
  it("matches by zone name and table number, not another zone's same number", () => {
    const alerts = matchTableAlerts({ proposals: [proposal(12, "Terraza")], requests: [] }, tables, zoneNameOf)
    expect(alerts.get("t-terraza-12")).toEqual({ kinds: new Set(["proposal"]), count: 1 })
    expect(alerts.has("t-salon-12")).toBe(false)
  })

  it("counts every item and collects their kinds", () => {
    const alerts = matchTableAlerts(
      { proposals: [proposal(12, "Salón")], requests: [request("bill", 12, "Salón"), request("waiter", 12, "Salón")] },
      tables,
      zoneNameOf,
    )
    expect(alerts.get("t-salon-12")).toEqual({ kinds: new Set(["proposal", "bill", "waiter"]), count: 3 })
    expect(alerts.size).toBe(1)
  })

  it("without a zone name matches only a table number that is unique", () => {
    const alerts = matchTableAlerts({ proposals: [], requests: [request("waiter", 5, null), request("bill", 12, null)] }, tables, zoneNameOf)
    expect(alerts.get("t-salon-5")?.count).toBe(1)
    expect(alerts.has("t-salon-12")).toBe(false)
    expect(alerts.has("t-terraza-12")).toBe(false)
  })

  it("with two zones sharing a name, an ambiguous number badges no table", () => {
    const twins = (zoneId?: string) => ({ "z-t": "Salón", "z-s": "salón " })[zoneId ?? ""]
    const alerts = matchTableAlerts({ proposals: [], requests: [request("bill", 12, "Salón"), request("waiter", 5, "Salón")] }, tables, twins)
    expect(alerts.has("t-terraza-12")).toBe(false)
    expect(alerts.has("t-salon-12")).toBe(false)
    expect(alerts.get("t-salon-5")?.count).toBe(1)
  })

  it("an empty or missing inbox gives no alerts", () => {
    expect(matchTableAlerts(undefined, tables, zoneNameOf).size).toBe(0)
  })
})

describe("alert wording", () => {
  it("names each kind, bill first, and picks the icon by priority", () => {
    const alert = { kinds: new Set(["proposal", "waiter", "bill"] as const), count: 3 }
    expect(alertText(alert)).toBe("pide la cuenta, llama al mesero, pedido de la carta por confirmar")
    expect(alertIconKind(alert)).toBe("bill")
    expect(alertIconKind({ kinds: new Set(["proposal", "waiter"] as const), count: 2 })).toBe("waiter")
  })
})
