import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import type { DeliveryInboxRequest } from "@/lib/api/carta-delivery"

/** T7 (S15) — the delivery console's "Carta" button and its pending guest requests. */

const env = vi.hoisted(() => ({
  requests: [] as unknown[],
  get: vi.fn(),
  post: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  refreshActive: vi.fn(),
  listeners: [] as ((payload: unknown) => void)[],
}))

vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: env.post } }))
vi.mock("@/hooks/use-toast", () => ({ toast: env.toast }))
vi.mock("@/hooks/use-active-deliveries", () => ({ refreshActiveDeliveries: env.refreshActive }))
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

import { CartaDeliveryInbox } from "./CartaDeliveryInbox"

const request: DeliveryInboxRequest = {
  id: "r-1",
  customerName: "Laura Gómez",
  registeredName: "Laura Patricia Gómez",
  phone: "3001234567",
  address: "Calle 63 # 9-42, apto 501",
  neighborhood: "Chapinero Alto",
  notes: "Portería",
  paymentMethod: "cash",
  cashFrom: 50000,
  deliveryFee: 4000,
  createdAt: "2026-11-12T19:05:00.000Z",
  lines: [
    { dishId: "d-1", name: "Churrasco 300 g", quantity: 2, note: "bien asado", options: [{ id: "o-1", name: "Arroz con coco" }] },
    { dishId: "d-2", name: "Limonada de coco", quantity: 1, note: null, options: [] },
  ],
  previewSubtotal: 101700,
  previewTax: 8136,
  previewTotal: 113836,
}

const CONFIRMED = {
  requestId: "r-1",
  status: "confirmed",
  order: { orderId: "o-1", customerId: "c-1", addressId: null, delivery: {}, consumption: { shortages: [] }, printJob: null },
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

async function openInbox(role = "delivery_operator") {
  render(wrap(<CartaDeliveryInbox role={role} />))
  fireEvent.click(await screen.findByRole("button", { name: "Carta (1 pendiente)" }))
  return screen.findByRole("dialog", { name: "Domicilios de la carta" })
}

beforeEach(() => {
  env.requests = [request]
  env.get.mockReset().mockImplementation(async () => ({ data: env.requests }))
  env.post.mockReset().mockResolvedValue({ data: undefined })
  env.toast.success.mockReset()
  env.toast.warning.mockReset()
  env.toast.error.mockReset()
  env.refreshActive.mockReset()
  env.listeners = []
})

describe("carta delivery inbox", () => {
  it("lists the pending request with customer, warning, address, payment, lines and total", async () => {
    const dialog = await openInbox()
    expect(env.get).toHaveBeenCalledWith("/api/carta-delivery")
    const card = within(dialog).getByRole("article", { name: "Laura Gómez" })
    expect(within(card).getByText("Registrado como Laura Patricia Gómez; se mantiene ese nombre")).toBeInTheDocument()
    expect(within(card).getByText("300 123 4567")).toBeInTheDocument()
    expect(within(card).getByText("Calle 63 # 9-42, apto 501 · Chapinero Alto")).toBeInTheDocument()
    expect(within(card).getByText("Portería")).toBeInTheDocument()
    expect(within(card).getByText("Efectivo · paga con $50.000")).toBeInTheDocument()
    expect(within(card).getByText("2 × Churrasco 300 g")).toBeInTheDocument()
    expect(within(card).getByText("Arroz con coco")).toBeInTheDocument()
    expect(within(card).getByText("“bien asado”")).toBeInTheDocument()
    expect(within(card).getByText("1 × Limonada de coco")).toBeInTheDocument()
    expect(within(card).getByText("Total $113.836 (incluye impuesto $8.136 y envío $4.000)")).toBeInTheDocument()
  })

  it("no warning when the name matches or the customer is new", async () => {
    env.requests = [{ ...request, registeredName: null, paymentMethod: "transfer", cashFrom: null }]
    const dialog = await openInbox()
    expect(within(dialog).queryByText(/Registrado como/)).not.toBeInTheDocument()
    expect(within(dialog).getByText("Transferencia")).toBeInTheDocument()
  })

  it("shows an empty state", async () => {
    env.requests = []
    render(wrap(<CartaDeliveryInbox role="admin" />))
    fireEvent.click(await screen.findByRole("button", { name: "Carta" }))
    expect(await screen.findByText("No hay domicilios de la carta por confirmar.")).toBeInTheDocument()
  })

  it("confirm creates the order, then does what the console's own create does", async () => {
    const dialog = await openInbox()
    env.post.mockResolvedValueOnce({ data: CONFIRMED })
    env.requests = []
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    await waitFor(() => expect(env.refreshActive).toHaveBeenCalledTimes(1))
    expect(env.post).toHaveBeenCalledWith("/api/carta-delivery/{id}/confirm", { params: { path: { id: "r-1" } } })
    expect(env.toast.success).toHaveBeenCalledWith("Domicilio creado y enviado a cocina")
    await waitFor(() => expect(within(dialog).queryByRole("article", { name: "Laura Gómez" })).not.toBeInTheDocument())
  })

  it("a confirm with shortages warns like the console form", async () => {
    const dialog = await openInbox()
    env.post.mockResolvedValueOnce({
      data: { ...CONFIRMED, order: { ...CONFIRMED.order, consumption: { shortages: [{ name: "Res", unit: "kg", missing: 1 }] } } },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    await waitFor(() =>
      expect(env.toast.warning).toHaveBeenCalledWith("El domicilio se creó y se envió a cocina, pero hay stock insuficiente: Res (faltan 1 kg)."),
    )
    expect(env.refreshActive).toHaveBeenCalledTimes(1)
  })

  it("a refused confirm stays on the card", async () => {
    const dialog = await openInbox()
    env.post.mockRejectedValueOnce(new ApiError(409, "Conflict", "Este pedido ya fue atendido."))
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Este pedido ya fue atendido.")
    expect(env.refreshActive).not.toHaveBeenCalled()
  })

  it("rejects with an optional reason", async () => {
    const dialog = await openInbox()
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar" }))
    fireEvent.change(within(dialog).getByLabelText("Motivo (opcional)"), { target: { value: "No llegamos a ese barrio" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar pedido" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta-delivery/{id}/reject", {
        params: { path: { id: "r-1" } },
        body: { reason: "No llegamos a ese barrio" },
      }),
    )
    expect(env.refreshActive).not.toHaveBeenCalled()
  })

  it("a cashier sees the requests and can reject, but confirm is disabled with the reason", async () => {
    const dialog = await openInbox("cashier")
    expect(within(dialog).getByRole("button", { name: "Confirmar" })).toBeDisabled()
    expect(within(dialog).getByText("Solo el administrador o el operador de domicilios confirman.")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Rechazar" })).toBeEnabled()
  })

  it("other roles get no button", () => {
    render(wrap(<CartaDeliveryInbox role="kitchen" />))
    expect(screen.queryByRole("button", { name: /^Carta/ })).not.toBeInTheDocument()
    expect(env.get).not.toHaveBeenCalled()
  })

  it("refreshes live from the carta stream", async () => {
    env.requests = []
    render(wrap(<CartaDeliveryInbox role="admin" />))
    await screen.findByRole("button", { name: "Carta" })
    env.requests = [request]
    act(() => env.listeners.forEach((l) => l({ table: "carta_delivery_requests" })))
    expect(await screen.findByRole("button", { name: "Carta (1 pendiente)" })).toBeInTheDocument()
  })

  it("renders nothing without a query client (isolated role views)", () => {
    const { container } = render(<CartaDeliveryInbox role="admin" />)
    expect(container).toBeEmptyDOMElement()
  })
})
