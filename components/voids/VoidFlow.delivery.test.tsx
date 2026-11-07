import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/**
 * F3b (S1 a) — cancelling a Domicilio uses the same step sheet: a reason is
 * always required; the supervisor step appears only when the delivery is paid
 * (user decision "Solo si ya está pagado"), and then it says the payment is
 * voided and the money goes back to the customer.
 */

const auth = vi.hoisted(() => ({ authorizeSupervisor: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<object>()), ...auth }))
const orders = vi.hoisted(() => ({ cancelOrder: vi.fn(), voidOrderItems: vi.fn(), getById: vi.fn() }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<object>()), ...orders }))
const delivery = vi.hoisted(() => ({ cancelDelivery: vi.fn() }))
vi.mock("@/lib/api/delivery", async (importOriginal) => ({ ...(await importOriginal<object>()), ...delivery }))
vi.mock("@/lib/api/payments", () => ({ voidPayment: vi.fn() }))
vi.mock("@/lib/api/config", () => ({ CONFIG_QUERY_KEY: ["config"], fetchConfig: async () => ({ allowSelfAuthorization: false }) }))

import { VoidFlow } from "./VoidFlow"
import type { Supervisor, VoidTarget } from "./flow"

const laura: Supervisor = { id: "c", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null }
const operator = { id: "op", name: "Operadora Ana", role: "delivery_operator" }

const unpaid: VoidTarget = { action: "order", orderId: "d-1", label: "#41 · Ana Ruiz", lines: [], total: 37000, delivery: true }
const paid: VoidTarget = { ...unpaid, hasPayments: true }

let loadSupervisors: ReturnType<typeof vi.fn<() => Promise<Supervisor[]>>>

function renderFlow(target: VoidTarget) {
  const onDone = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <VoidFlow target={target} actor={operator} loadSupervisors={loadSupervisors} onDone={onDone} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
  return { onDone }
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const pickReason = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }))

beforeEach(() => {
  vi.clearAllMocks()
  loadSupervisors = vi.fn(async () => [laura])
  delivery.cancelDelivery.mockResolvedValue({ orderId: "d-1", status: "cancelled" })
  // The live payment total comes from the order itself: pay_order leaves orders.total = bill + fee + tip.
  orders.getById.mockResolvedValue({ id: "d-1", status: "paid", total: 37000 })
})

describe("VoidFlow · Domicilio", () => {
  it("an unpaid delivery is cancelled with a reason and no supervisor, through the delivery endpoint", async () => {
    const { onDone } = renderFlow(unpaid)
    expect(screen.getByText(/Cancelar domicilio · #41 · Ana Ruiz/)).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Pasos" })).not.toBeInTheDocument()
    const confirm = screen.getByRole("button", { name: "Cancelar domicilio" })
    expect(confirm).toBeDisabled()
    pickReason("Otro")
    fireEvent.change(screen.getByLabelText("Escribe el motivo (obligatorio)"), { target: { value: "  No  contesta " } })
    click("Cancelar domicilio")
    await screen.findByRole("heading", { name: "Domicilio cancelado" })
    expect(delivery.cancelDelivery).toHaveBeenCalledWith("d-1", { reason: "other", reasonText: "No contesta" })
    expect(orders.cancelOrder).not.toHaveBeenCalled()
    expect(auth.authorizeSupervisor).not.toHaveBeenCalled()
    expect(loadSupervisors).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledWith({ action: "order", orderId: "d-1" })
    expect(screen.getByText("El domicilio pasa a Canceladas con su motivo.")).toBeInTheDocument()
  })

  it("a paid delivery asks for a supervisor, warns that the payment is voided, and sends the authorization bound to the order", async () => {
    auth.authorizeSupervisor.mockResolvedValue({
      authorizationId: "auth-9",
      action: "cancel_order",
      targetType: "order",
      targetId: "d-1",
      supervisor: { id: "c", name: "Laura Gómez" },
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    })
    renderFlow(paid)
    expect(screen.getByRole("list", { name: "Pasos" })).toBeInTheDocument()
    pickReason("El cliente se fue")
    click("Elegir quién autoriza")
    expect(await screen.findByText(/El pago de \$\s?37\.000 se anula: devuelve el dinero al cliente/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole("radio", { name: /Laura Gómez/ }))
    await screen.findByRole("heading", { name: "Laura, escribe tu PIN" })
    expect(screen.getByText(/El pago de \$\s?37\.000 se anula: devuelve el dinero al cliente/)).toBeInTheDocument()
    const pad = screen.getByRole("group", { name: "Teclado del PIN" })
    for (const digit of "5820") fireEvent.click(within(pad).getByRole("button", { name: digit }))
    fireEvent.click(within(pad).getByRole("button", { name: "Autorizar" }))
    await screen.findByRole("heading", { name: "Domicilio cancelado" })
    expect(auth.authorizeSupervisor).toHaveBeenCalledWith({ pin: "5820", action: "cancel_order", profileId: "c", targetType: "order", targetId: "d-1" })
    expect(delivery.cancelDelivery).toHaveBeenCalledWith("d-1", { reason: "customer_left", reasonText: null, authorizationId: "auth-9" })
    expect(screen.getByText("Laura Gómez")).toBeInTheDocument()
  })

  it("a delivery that turns out paid (authorization_required) goes to the supervisor step", async () => {
    delivery.cancelDelivery.mockRejectedValueOnce(
      new ApiError(403, "Forbidden", "Esta acción necesita la autorización de un supervisor", { code: "authorization_required" }),
    )
    renderFlow(unpaid)
    pickReason("Plato devuelto")
    click("Cancelar domicilio")
    await screen.findByRole("heading", { name: "¿Quién autoriza?" })
    expect(await screen.findByRole("radio", { name: /Laura Gómez/ })).toBeInTheDocument()
  })

  it("the warning shows the real payment total, tip included, not the board's estimate (A3)", async () => {
    orders.getById.mockResolvedValue({ id: "d-1", status: "paid", total: 39000 })
    renderFlow(paid)
    pickReason("El cliente se fue")
    click("Elegir quién autoriza")
    expect(await screen.findByText(/El pago de \$\s?39\.000 se anula: devuelve el dinero al cliente/)).toBeInTheDocument()
    expect(orders.getById).toHaveBeenCalledWith("d-1")
  })

  it("a stale board (paid meanwhile) still warns about the payment in the supervisor step (A4)", async () => {
    delivery.cancelDelivery.mockRejectedValueOnce(
      new ApiError(403, "Forbidden", "Esta acción necesita la autorización de un supervisor", { code: "authorization_required" }),
    )
    orders.getById.mockResolvedValue({ id: "d-1", status: "paid", total: 41000 })
    renderFlow(unpaid)
    pickReason("Plato devuelto")
    click("Cancelar domicilio")
    await screen.findByRole("heading", { name: "¿Quién autoriza?" })
    expect(await screen.findByText(/El pago de \$\s?41\.000 se anula: devuelve el dinero al cliente/)).toBeInTheDocument()
  })

  it("without the amount it still says the payment is voided (A4)", async () => {
    delivery.cancelDelivery.mockRejectedValueOnce(
      new ApiError(403, "Forbidden", "Esta acción necesita la autorización de un supervisor", { code: "authorization_required" }),
    )
    orders.getById.mockRejectedValue(new Error("offline"))
    renderFlow(unpaid)
    pickReason("Plato devuelto")
    click("Cancelar domicilio")
    await screen.findByRole("heading", { name: "¿Quién autoriza?" })
    expect(await screen.findByText("Este domicilio ya tiene un pago; se anula al cancelar")).toBeInTheDocument()
  })

  it("refuses with the server message when the delivery already left", async () => {
    delivery.cancelDelivery.mockRejectedValueOnce(
      new ApiError(409, "Conflict", "El domicilio ya salió o fue entregado; no se puede cancelar", { code: "delivery_not_cancellable" }),
    )
    renderFlow(unpaid)
    pickReason("Plato devuelto")
    click("Cancelar domicilio")
    expect(await screen.findByRole("alert")).toHaveTextContent("El domicilio ya salió o fue entregado; no se puede cancelar")
  })
})
