import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AuditEvent } from "@/lib/api/audit"

/**
 * F3 (S1 a) — admin "Anulaciones" (design/anulaciones/01, vista auditoria):
 * filters sent to GET /audit, totals cards over what it returned, the list and
 * a CSV of exactly the listed events.
 */

const audit = vi.hoisted(() => ({ calls: [] as unknown[], events: [] as unknown[] }))
vi.mock("@/lib/api/audit", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAuditEvents: async (filter: unknown) => {
    audit.calls.push(filter)
    return audit.events
  },
}))
vi.mock("@/lib/api/staff", () => ({
  listStaff: async () => [
    { id: "w1", fullName: "Andrés", role: "waiter", active: true, hasPin: false, pinLockedUntil: null },
    { id: "a1", fullName: "Carlos Pérez", role: "admin", active: true, hasPin: true, pinLockedUntil: null },
    { id: "c1", fullName: "Laura Gómez", role: "cashier", active: true, hasPin: true, pinLockedUntil: null },
  ],
}))

vi.mock("@/lib/api/payments", () => ({
  listPaymentMethods: async () => [{ id: "pm1", code: "card", name: "Tarjeta", kind: "electronic", isActive: true, sortOrder: 1 }],
}))

import { VoidsPage } from "./VoidsPage"
import { localDayKey } from "@/lib/admin/dates"

const at = (h: number, m: number) => new Date(2026, 10, 7, h, m).toISOString()
function event(over: Partial<AuditEvent>): AuditEvent {
  return {
    id: "e",
    eventType: "items_voided",
    orderId: "o",
    orderNumber: 128,
    paymentId: null,
    actor: { id: "w1", name: "Andrés" },
    authorizedBy: { id: "a1", name: "Carlos Pérez" },
    selfAuthorized: false,
    reason: "dish_returned",
    reasonLabel: "Plato devuelto",
    reasonText: null,
    orderType: "dine_in",
    amount: 32900,
    details: { lines: [{ name: "Bandeja paisa", quantity: 1, amount: 32900 }] },
    createdAt: at(12, 44),
    ...over,
  }
}

const EVENTS = [
  event({ id: "1" }),
  event({ id: "2", eventType: "payment_voided", orderNumber: 131, amount: 86400, reason: "duplicate_charge", reasonLabel: "Cobro duplicado", details: { methods: "card" }, actor: { id: "c1", name: "Laura Gómez" }, createdAt: at(12, 20) }),
  event({ id: "3", eventType: "order_cancelled", orderNumber: 127, amount: 39300, selfAuthorized: true, actor: { id: "c1", name: "Laura Gómez" }, authorizedBy: { id: "c1", name: "Laura Gómez" }, details: { items: [{}, {}] }, createdAt: at(10, 52) }),
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <VoidsPage description="Todo lo cancelado o anulado." />
    </QueryClientProvider>,
  )
}

const lastCall = () => audit.calls[audit.calls.length - 1]

beforeEach(() => {
  audit.calls = []
  audit.events = EVENTS
})
afterEach(() => vi.restoreAllMocks())

describe("VoidsPage", () => {
  it("reads today's events and shows the totals cards and the rows", async () => {
    renderPage()
    const today = localDayKey(new Date())
    await waitFor(() => expect(audit.calls[0]).toEqual({ from: today, to: today }))

    const cards = await screen.findByRole("list", { name: "Totales" })
    const items = within(cards).getAllByRole("listitem")
    expect(items[0]).toHaveTextContent(/Órdenes canceladas.*39\.300.*1 orden/)
    expect(items[1]).toHaveTextContent(/Platos anulados.*32\.900.*1 plato/)
    expect(items[2]).toHaveTextContent(/Pagos anulados.*86\.400.*1 pago/)
    expect(items[3]).toHaveTextContent(/Autoautorizadas.*39\.300.*1 registro/)

    const table = screen.getByRole("table", { name: "Anulaciones" })
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent(/12:44.*Plato anulado.*#128.*1× Bandeja paisa.*Plato devuelto.*Andrés.*Carlos Pérez/)
    expect(rows[1]).toHaveTextContent(/#131.*Tarjeta/)
    expect(rows[2]).toHaveTextContent("Autoautorizada")
    expect(screen.getByText(/3 registros · los montos anulados no cuentan en ventas ni en caja/)).toBeInTheDocument()
  })

  it("sends every filter to GET /audit", async () => {
    renderPage()
    await screen.findByRole("table", { name: "Anulaciones" })
    await screen.findByRole("option", { name: "Andrés" })

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "payment_voided" } })
    await waitFor(() => expect(lastCall()).toMatchObject({ types: ["payment_voided"] }))
    fireEvent.change(screen.getByLabelText("Pidió"), { target: { value: "c1" } })
    await waitFor(() => expect(lastCall()).toMatchObject({ actorId: "c1" }))
    fireEvent.change(screen.getByLabelText("Autorizó"), { target: { value: "a1" } })
    await waitFor(() => expect(lastCall()).toMatchObject({ authorizerId: "a1" }))
    fireEvent.click(screen.getByRole("switch", { name: "Solo autoautorizadas" }))
    await waitFor(() => expect(lastCall()).toMatchObject({ selfAuthorized: true }))
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-11-01" } })
    await waitFor(() => expect(lastCall()).toMatchObject({ from: "2026-11-01" }))
    expect(within(screen.getByLabelText("Autorizó")).queryByRole("option", { name: "Andrés" })).toBeNull()
  })

  it("exports the listed events as CSV", async () => {
    let blob: Blob | null = null
    const create = vi.fn((b: Blob) => {
      blob = b
      return "blob:x"
    })
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    renderPage()
    await screen.findByRole("table", { name: "Anulaciones" })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }))
    })
    expect(click).toHaveBeenCalled()
    const text = await blob!.text()
    expect(text.split("\r\n")).toHaveLength(4)
    expect(text).toContain("Pago anulado")
  })

  it("labels a delivery cancellation Domicilio with its customer (F3b)", async () => {
    audit.events = [
      event({ id: "d", eventType: "order_cancelled", orderType: "delivery", orderNumber: 41, amount: 37000, authorizedBy: null, actor: { id: "op", name: "Operadora Ana" }, details: { items: [{}], customer_name: "Ana Ruiz", delivery_fee: 5000 } }),
    ]
    renderPage()
    const row = (await screen.findByText("#41")).closest("tr")!
    expect(within(row).getByText("Domicilio")).toBeInTheDocument()
    expect(row).toHaveTextContent("Ana Ruiz")
    expect(row).toHaveTextContent("Operadora Ana")
    expect(row).toHaveTextContent("No hizo falta")
  })

  it("says so when nothing matches", async () => {
    audit.events = []
    renderPage()
    expect(await screen.findByText("No hay anulaciones con estos filtros.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled()
  })
})
