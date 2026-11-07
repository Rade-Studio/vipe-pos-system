import { describe, expect, it } from "vitest"
import type { AuditEvent } from "@/lib/api/audit"
import type { CancelledOrderDto } from "@/lib/api/orders"
import { auditCsv, auditReason, auditSubject, auditTotals, cancelledTotals } from "./voids"

const staff = (name: string) => ({ id: name, name })

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "e",
    eventType: "items_voided",
    orderId: "o",
    orderNumber: 128,
    orderType: "dine_in",
    paymentId: null,
    actor: staff("Andrés"),
    authorizedBy: staff("Carlos Pérez"),
    selfAuthorized: false,
    reason: "dish_returned",
    reasonLabel: "Plato devuelto",
    reasonText: null,
    amount: 32900,
    details: { lines: [{ name: "Bandeja paisa", quantity: 1, amount: 32900 }] },
    createdAt: new Date(2026, 10, 7, 12, 44).toISOString(),
    ...overrides,
  }
}

const events: AuditEvent[] = [
  event({ id: "1" }),
  event({ id: "2", eventType: "payment_voided", amount: 86400, paymentId: "p", reason: "duplicate_charge", reasonLabel: "Cobro duplicado", details: { methods: "card" } }),
  event({ id: "3", eventType: "order_cancelled", amount: 23800, details: { items: [{}, {}, {}] } }),
  event({ id: "4", eventType: "order_cancelled", amount: 39300, selfAuthorized: true, details: { items: [{}, {}] } }),
  event({ id: "5", amount: 6000, details: { lines: [{ name: "Limonada", quantity: 2, amount: 6000 }] } }),
]

describe("audit page totals", () => {
  it("sums each type, units of voided dishes and the self-authorized events", () => {
    expect(auditTotals(events)).toEqual({
      cancelled: { amount: 63100, count: 2 },
      items: { amount: 38900, units: 3 },
      payments: { amount: 86400, count: 1 },
      selfAuthorized: { amount: 39300, count: 1 },
    })
    expect(auditTotals([])).toEqual({
      cancelled: { amount: 0, count: 0 },
      items: { amount: 0, units: 0 },
      payments: { amount: 0, count: 0 },
      selfAuthorized: { amount: 0, count: 0 },
    })
  })

  it("names the subject of each event from what the API stored", () => {
    expect(auditSubject(events[0])).toEqual({ title: "#128", detail: "1× Bandeja paisa" })
    expect(auditSubject(events[1])).toEqual({ title: "#128", detail: "card" })
    expect(auditSubject(event({ eventType: "payment_voided", details: { methods: "card, cash" } }), (code) => ({ card: "Tarjeta", cash: "Efectivo" })[code] ?? code)).toEqual({
      title: "#128",
      detail: "Tarjeta + Efectivo",
    })
    expect(auditSubject(events[2])).toEqual({ title: "#128", detail: "3 platos" })
    expect(auditSubject(event({ orderNumber: null, eventType: "order_cancelled", details: { items: [{}] } }))).toEqual({
      title: "Orden",
      detail: "1 plato",
    })
  })

  it("shows 'Otro: «text»' for the free reason", () => {
    expect(auditReason(events[0])).toBe("Plato devuelto")
    expect(auditReason(event({ reason: "other", reasonLabel: "Otro", reasonText: "Salió frío" }))).toBe("Otro: «Salió frío»")
  })

  it("exports a CSV with one quoted row per event", () => {
    const csv = auditCsv([event({ reason: "other", reasonLabel: "Otro", reasonText: 'dijo "no"', selfAuthorized: true })])
    const [header, row] = csv.split("\r\n")
    expect(header).toBe("Fecha,Hora,Tipo,Orden,Detalle,Motivo,Pidió,Autorizó,Autoautorizada,Monto")
    expect(row).toBe('2026-11-07,12:44,Plato anulado,#128,1× Bandeja paisa,"Otro: «dijo ""no""»",Andrés,Carlos Pérez,Sí,32900')
  })
})

describe("Canceladas totals", () => {
  it("counts the orders and sums the bill each had when it was cancelled", () => {
    const orders = [{ cancellation: { total: 23800 } }, { cancellation: { total: 39300 } }] as CancelledOrderDto[]
    expect(cancelledTotals(orders)).toEqual({ count: 2, total: 63100 })
  })
})
