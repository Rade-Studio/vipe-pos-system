import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"

/** T5 (S12, S14) — the waiter's carta inbox through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  confirmErrorMessage,
  confirmProposal,
  getInbox,
  kitchenCommandFor,
  rejectProposal,
  resolveRequest,
  type InboxProposal,
} from "./carta-inbox"

const proposal: InboxProposal = {
  id: "p-1",
  orderId: "o-1",
  tableNumber: 12,
  zoneName: "Terraza",
  waiterName: "Carolina",
  note: "Somos 4",
  createdAt: "2026-11-12T13:05:00.000Z",
  lines: [
    { dishId: "d-1", name: "Bandeja", quantity: 2, note: "sin cebolla", options: [{ id: "op-1", name: "Término medio" }] },
    { dishId: "d-2", name: "Limonada", quantity: 1, note: null, options: [] },
  ],
}

const byId = { params: { path: { id: "p-1" } } }

beforeEach(() => {
  api.GET.mockReset()
  api.POST.mockReset()
})

describe("carta inbox requests", () => {
  it("lists the inbox", async () => {
    api.GET.mockResolvedValue({ data: { proposals: [proposal], requests: [] } })
    await expect(getInbox()).resolves.toEqual({ proposals: [proposal], requests: [] })
    expect(api.GET).toHaveBeenCalledWith("/api/carta-inbox")
  })

  it("confirms, rejects with an optional reason and resolves a request", async () => {
    const confirmed = { proposalId: "p-1", orderId: "o-1", status: "confirmed", stage: "kitchen", orderItemIds: ["i-1", "i-2"] }
    api.POST.mockResolvedValueOnce({ data: confirmed })
    await expect(confirmProposal("p-1")).resolves.toEqual(confirmed)
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-inbox/proposals/{id}/confirm", byId)

    api.POST.mockResolvedValue({ data: undefined })
    await rejectProposal("p-1", "  Se acabó  ")
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-inbox/proposals/{id}/reject", { ...byId, body: { reason: "Se acabó" } })
    await rejectProposal("p-1", "   ")
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-inbox/proposals/{id}/reject", { ...byId, body: { reason: null } })

    await resolveRequest("r-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/carta-inbox/requests/{id}/resolve", { params: { path: { id: "r-1" } } })
  })

  it("fails on a confirm without body", async () => {
    api.POST.mockResolvedValue({ data: undefined })
    await expect(confirmProposal("p-1")).rejects.toThrow("Empty API response")
  })
})

describe("kitchen comanda of a confirmed proposal", () => {
  it("prints the proposal's lines for its order and table, with the added item ids", () => {
    expect(kitchenCommandFor(proposal, ["i-1", "i-2"])).toEqual({
      orderId: "o-1",
      table: 12,
      items: [
        { id: "i-1", dishId: "d-1", name: "Bandeja", quantity: 2, comments: "sin cebolla", modifiers: [{ group: "", name: "Término medio", price: 0 }] },
        { id: "i-2", dishId: "d-2", name: "Limonada", quantity: 1 },
      ],
    })
  })
})

describe("confirm errors in Spanish", () => {
  it("maps the waiter send's stock and price 409s like the waiter app", () => {
    const stock = new ApiError(409, "Conflict", "Insufficient stock", {
      shortages: [{ name: "Res", required: 2, available: 1, unit: "kg" }],
    })
    expect(confirmErrorMessage(stock)).toBe("No hay stock suficiente: Res (se necesitan 2 kg, hay 1 kg).")
    const price = new ApiError(409, "Conflict", "Price changed", { prices: [] })
    expect(confirmErrorMessage(price)).toBe("Algunos precios cambiaron. Revisa la carta e intenta de nuevo.")
  })

  it("keeps the carta API's Spanish 409/422 messages and falls back for anything else", () => {
    expect(confirmErrorMessage(new ApiError(409, "Conflict", "Este pedido ya fue confirmado o rechazado."))).toBe(
      "Este pedido ya fue confirmado o rechazado.",
    )
    expect(confirmErrorMessage(new ApiError(422, "Unprocessable", "Revisa las opciones elegidas para el plato."))).toBe(
      "Revisa las opciones elegidas para el plato.",
    )
    expect(confirmErrorMessage(new Error("network"))).toBe("No se pudo confirmar el pedido. Intenta de nuevo.")
  })
})
