import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import type { CartaInbox as Inbox } from "@/lib/api/carta-inbox"

/** T5 (S12, S14) — the waiter's carta inbox: proposals and requests, live. */

const env = vi.hoisted(() => ({
  inbox: null as unknown as Inbox,
  get: vi.fn(),
  post: vi.fn(),
  sendCommand: vi.fn(),
  printing: true,
  listeners: [] as ((payload: unknown) => void)[],
}))

vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: env.post } }))
vi.mock("@/lib/api/print", () => ({ sendCommand: env.sendCommand }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => env.printing }))
vi.mock("@/lib/api/realtime", () => ({
  realtimeService: {
    subscribeToCartaInbox: (cb: (payload: unknown) => void) => {
      env.listeners.push(cb)
      return () => {
        env.listeners = env.listeners.filter((l) => l !== cb)
      }
    },
  },
}))

import { CartaInbox } from "./CartaInbox"
import { TerminalContext, type IdentityRequest, type TerminalApi } from "@/components/terminal/terminal-context"
import { actingToken, clearActingToken, setActingToken } from "@/lib/terminal/acting"
import { StepSheet, StepHeader } from "@/components/voids/sheet"
import { useState } from "react"

const proposal = {
  id: "p-1",
  orderId: "o-1",
  tableNumber: 12,
  zoneName: "Terraza",
  waiterName: "Carolina",
  note: "Somos 4, todo junto",
  createdAt: "2026-11-12T13:05:00.000Z",
  lines: [
    { dishId: "d-1", name: "Bandeja paisa", quantity: 2, note: "sin cebolla", options: [{ id: "op-1", name: "Término medio" }] },
    { dishId: "d-2", name: "Limonada", quantity: 1, note: null, options: [] },
  ],
}
const billRequest = {
  id: "r-1",
  kind: "bill" as const,
  orderId: "o-1",
  tableNumber: 12,
  zoneName: "Terraza",
  waiterName: "Carolina",
  createdAt: "2026-11-12T13:20:00.000Z",
}
const waiterRequest = { ...billRequest, id: "r-2", kind: "waiter" as const, tableNumber: 5, zoneName: null }

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

async function openInbox() {
  render(wrap(<CartaInbox />))
  const button = await screen.findByRole("button", { name: "Carta (3 pendientes)" })
  fireEvent.click(button)
  return screen.findByRole("dialog", { name: "Pedidos de la carta" })
}

beforeEach(() => {
  env.inbox = { proposals: [proposal], requests: [billRequest, waiterRequest] }
  env.get.mockReset().mockImplementation(async () => ({ data: env.inbox }))
  env.post.mockReset().mockResolvedValue({ data: undefined })
  env.sendCommand.mockReset()
  env.printing = true
  env.listeners = []
})

describe("carta inbox", () => {
  it("shows the pending count and lists proposals with lines, options, notes and requests", async () => {
    const dialog = await openInbox()
    expect(env.get).toHaveBeenCalledWith("/api/carta-inbox")
    const card = within(dialog).getByRole("article", { name: "Mesa 12 · Terraza" })
    expect(within(card).getByText("Por confirmar")).toBeInTheDocument()
    expect(within(card).getByText("2 × Bandeja paisa")).toBeInTheDocument()
    expect(within(card).getByText("Término medio")).toBeInTheDocument()
    expect(within(card).getByText("“sin cebolla”")).toBeInTheDocument()
    expect(within(card).getByText("1 × Limonada")).toBeInTheDocument()
    expect(within(card).getByText("Nota del comensal: Somos 4, todo junto")).toBeInTheDocument()
    expect(within(dialog).getByText("Mesa 12 pide la cuenta")).toBeInTheDocument()
    expect(within(dialog).getByText("Mesa 5 llama al mesero")).toBeInTheDocument()
  })

  it("shows an empty state and no count without pending items", async () => {
    env.inbox = { proposals: [], requests: [] }
    render(wrap(<CartaInbox />))
    fireEvent.click(await screen.findByRole("button", { name: "Carta" }))
    expect(await screen.findByText("No hay pedidos ni solicitudes de la carta.")).toBeInTheDocument()
  })

  it("confirm calls the API, then queues the comanda with the returned item ids", async () => {
    const dialog = await openInbox()
    env.post.mockResolvedValueOnce({
      data: { proposalId: "p-1", orderId: "o-1", status: "confirmed", stage: "kitchen", orderItemIds: ["i-1", "i-2"] },
    })
    env.inbox = { proposals: [], requests: [billRequest, waiterRequest] }
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    await waitFor(() => expect(env.sendCommand).toHaveBeenCalledTimes(1))
    expect(env.post).toHaveBeenCalledWith("/api/carta-inbox/proposals/{id}/confirm", { params: { path: { id: "p-1" } } })
    expect(env.sendCommand).toHaveBeenCalledWith({
      orderId: "o-1",
      table: 12,
      items: [
        { id: "i-1", dishId: "d-1", name: "Bandeja paisa", quantity: 2, comments: "sin cebolla", modifiers: [{ group: "", name: "Término medio", price: 0 }] },
        { id: "i-2", dishId: "d-2", name: "Limonada", quantity: 1 },
      ],
    })
    await waitFor(() => expect(within(dialog).queryByRole("article", { name: "Mesa 12 · Terraza" })).not.toBeInTheDocument())
  })

  it("does not print when the restaurant has no printers", async () => {
    env.printing = false
    const dialog = await openInbox()
    env.post.mockResolvedValueOnce({ data: { proposalId: "p-1", orderId: "o-1", status: "confirmed", stage: "kitchen", orderItemIds: ["i-1"] } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    await waitFor(() => expect(env.post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(env.get).toHaveBeenCalledTimes(2))
    expect(env.sendCommand).not.toHaveBeenCalled()
  })

  it("shows a refused confirm in Spanish on the card and prints nothing", async () => {
    const dialog = await openInbox()
    env.post.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "Insufficient stock", { shortages: [{ name: "Res", required: 2, available: 1, unit: "kg" }] }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("No hay stock suficiente: Res (se necesitan 2 kg, hay 1 kg).")
    expect(env.sendCommand).not.toHaveBeenCalled()
  })

  it("rejects with an optional reason", async () => {
    const dialog = await openInbox()
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar" }))
    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "Se acabó la bandeja" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar pedido" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta-inbox/proposals/{id}/reject", {
        params: { path: { id: "p-1" } },
        body: { reason: "Se acabó la bandeja" },
      }),
    )
    expect(env.sendCommand).not.toHaveBeenCalled()
  })

  it("resolves a request with Atendido", async () => {
    const dialog = await openInbox()
    const request = within(dialog).getByRole("article", { name: "Mesa 12 pide la cuenta" })
    fireEvent.click(within(request).getByRole("button", { name: "Atendido" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta-inbox/requests/{id}/resolve", { params: { path: { id: "r-1" } } }),
    )
  })

  it("refreshes on a carta realtime event", async () => {
    render(wrap(<CartaInbox />))
    await screen.findByRole("button", { name: "Carta (3 pendientes)" })
    env.inbox = { proposals: [proposal, { ...proposal, id: "p-2", tableNumber: 3 }], requests: [billRequest, waiterRequest] }
    env.listeners.forEach((l) => l({ table: "carta_table_proposals", eventType: "INSERT", new: { id: "p-2" }, old: {} }))
    expect(await screen.findByRole("button", { name: "Carta (4 pendientes)" })).toBeInTheDocument()
  })

  describe("on a shared terminal (T5b, L29)", () => {
    /** The terminal around the waiter app: a valid PIN sets the acting claim the API client sends on writes. */
    function onTerminal(identified: boolean) {
      const ensureIdentity = vi.fn(async (_request: IdentityRequest) => {
        if (identified) setActingToken("acting-andres")
        return identified
      })
      const terminal: TerminalApi = { identity: null, now: 0, ensureIdentity, endIdentity: () => {}, requestLogout: () => {} }
      const sent: (string | null)[] = []
      env.post.mockImplementation(async (url: string) => {
        sent.push(actingToken())
        return url.endsWith("/confirm") ? { data: { proposalId: "p-1", orderId: "o-1", status: "confirmed", stage: "kitchen", orderItemIds: ["i-1", "i-2"] } } : { data: undefined }
      })
      render(wrap(<TerminalContext.Provider value={terminal}><CartaInbox /></TerminalContext.Provider>))
      return { ensureIdentity, sent }
    }
    const open = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Carta (3 pendientes)" }))
      return screen.findByRole("dialog", { name: "Pedidos de la carta" })
    }

    beforeEach(() => clearActingToken())

    it("confirm asks for the PIN first and sends the identified waiter's acting claim", async () => {
      const { ensureIdentity, sent } = onTerminal(true)
      fireEvent.click(within(await open()).getByRole("button", { name: "Confirmar" }))
      await waitFor(() => expect(env.post).toHaveBeenCalledWith("/api/carta-inbox/proposals/{id}/confirm", { params: { path: { id: "p-1" } } }))
      expect(ensureIdentity).toHaveBeenCalledWith({ label: "Mesa 12" })
      expect(sent).toEqual(["acting-andres"])
    })

    it("reject and Atendido go through the PIN too", async () => {
      const { ensureIdentity, sent } = onTerminal(true)
      const dialog = await open()
      fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar" }))
      fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar pedido" }))
      await waitFor(() => expect(env.post).toHaveBeenCalledTimes(1))
      const request = within(dialog).getByRole("article", { name: "Mesa 12 pide la cuenta" })
      fireEvent.click(within(request).getByRole("button", { name: "Atendido" }))
      await waitFor(() => expect(env.post).toHaveBeenCalledWith("/api/carta-inbox/requests/{id}/resolve", { params: { path: { id: "r-1" } } }))
      expect(ensureIdentity).toHaveBeenCalledTimes(2)
      expect(sent).toEqual(["acting-andres", "acting-andres"])
    })

    it("closing the PIN sheet returns focus to Atendido", async () => {
      let resolve: (ok: boolean) => void = () => {}
      function PinTerminal({ children }: { children: React.ReactNode }) {
        const [open, setOpen] = useState(false)
        const terminal: TerminalApi = {
          identity: null,
          now: 0,
          ensureIdentity: () =>
            new Promise<boolean>((done) => {
              resolve = done
              setOpen(true)
            }),
          endIdentity: () => {},
          requestLogout: () => {},
        }
        return (
          <TerminalContext.Provider value={terminal}>
            {children}
            <StepSheet
              open={open}
              onClose={() => {
                setOpen(false)
                resolve(false)
              }}
            >
              <StepHeader eyebrow="Mesa 12" title="Ingresa tu PIN" />
            </StepSheet>
          </TerminalContext.Provider>
        )
      }
      render(wrap(<PinTerminal><CartaInbox /></PinTerminal>))
      const request = within(await open()).getByRole("article", { name: "Mesa 12 pide la cuenta" })
      const attended = within(request).getByRole("button", { name: "Atendido" })
      attended.focus()
      fireEvent.click(attended)
      const pin = await screen.findByRole("dialog", { name: "Ingresa tu PIN" })
      fireEvent.click(within(pin).getByRole("button", { name: "Cerrar" }))
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ingresa tu PIN" })).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(attended))
      expect(env.post).not.toHaveBeenCalled()
    })

    it("a closed PIN sheet sends nothing", async () => {
      const { ensureIdentity } = onTerminal(false)
      fireEvent.click(within(await open()).getByRole("button", { name: "Confirmar" }))
      await waitFor(() => expect(ensureIdentity).toHaveBeenCalledTimes(1))
      expect(env.post).not.toHaveBeenCalled()
      expect(env.sendCommand).not.toHaveBeenCalled()
    })
  })
})
