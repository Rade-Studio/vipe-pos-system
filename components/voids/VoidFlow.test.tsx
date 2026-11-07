import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/**
 * F3 (S1 a) — the "hoja por pasos" (design/anulaciones/01): qué y motivo →
 * quién autoriza → PIN → listo, with the authorization bound to the exact
 * target (L15 round 2) and every refusal in Spanish.
 */

const auth = vi.hoisted(() => ({ authorizeSupervisor: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<object>()), ...auth }))
const orders = vi.hoisted(() => ({ cancelOrder: vi.fn(), voidOrderItems: vi.fn() }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<object>()), ...orders }))
const payments = vi.hoisted(() => ({ voidPayment: vi.fn() }))
vi.mock("@/lib/api/payments", () => payments)
const config = vi.hoisted(() => ({ allowSelfAuthorization: false }))
vi.mock("@/lib/api/config", () => ({
  CONFIG_QUERY_KEY: ["config"],
  fetchConfig: async () => ({ allowSelfAuthorization: config.allowSelfAuthorization }),
}))

import { VoidFlow } from "./VoidFlow"
import type { Supervisor, VoidTarget } from "./flow"
import { lockedUntilLabel } from "./flow"

const carlos: Supervisor = { id: "a", fullName: "Carlos Pérez", role: "admin", hasPin: true, pinLockedUntil: null }
const laura: Supervisor = { id: "c", fullName: "Laura Gómez", role: "cashier", hasPin: true, pinLockedUntil: null }
const cashier = { id: "c", name: "Laura Gómez", role: "cashier" as const }
const waiter = { id: "w", name: "Andrés", role: "waiter" as const }

const itemTarget: VoidTarget = {
  action: "item",
  orderId: "o-1",
  label: "#128 · Mesa 8",
  lines: [{ id: "l-1", name: "Bandeja paisa", price: 32900, quantity: 2 }],
  lineId: "l-1",
}
const orderTarget: VoidTarget = {
  action: "order",
  orderId: "o-1",
  label: "#128 · Mesa 8",
  lines: [{ id: "l-1", name: "Bandeja paisa", price: 32900, quantity: 2 }],
  total: 65800,
}
const paymentTarget: VoidTarget = {
  action: "payment",
  orderId: "o-3",
  label: "#131 · Mesa 12",
  payments: [{ id: "p-2", title: "Tarjeta · Ref. 4822", detail: "12:19", amount: 86400 }],
}

const authorization = {
  authorizationId: "auth-1",
  action: "void_item",
  targetType: "order",
  targetId: "o-1",
  supervisor: { id: "a", name: "Carlos Pérez" },
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
}

let loadSupervisors: ReturnType<typeof vi.fn<() => Promise<Supervisor[]>>>

function renderFlow(target: VoidTarget, actor: { id: string; name: string; role: "cashier" | "waiter" | "admin" } = cashier) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <VoidFlow target={target} actor={actor} loadSupervisors={loadSupervisors} onDone={onDone} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onDone, onClose }
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const pickReason = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }))
const typePin = (pin: string) => {
  const pad = screen.getByRole("group", { name: "Teclado del PIN" })
  for (const digit of pin) fireEvent.click(within(pad).getByRole("button", { name: digit }))
}

async function toPin(supervisor = "Carlos Pérez") {
  click("Elegir quién autoriza")
  fireEvent.click(await screen.findByRole("radio", { name: new RegExp(supervisor) }))
  await screen.findByRole("heading", { name: `${supervisor.split(" ")[0]}, escribe tu PIN` })
}

beforeEach(() => {
  auth.authorizeSupervisor.mockReset().mockResolvedValue(authorization)
  orders.voidOrderItems.mockReset().mockResolvedValue({ total: 32900 })
  orders.cancelOrder.mockReset().mockResolvedValue({})
  payments.voidPayment.mockReset().mockResolvedValue({})
  config.allowSelfAuthorization = false
  loadSupervisors = vi.fn<() => Promise<Supervisor[]>>().mockResolvedValue([carlos, laura])
})

describe("VoidFlow — anular plato", () => {
  it("walks qué y motivo → quién autoriza → PIN → listo and sends the exact target", async () => {
    const { onDone } = renderFlow(itemTarget)

    expect(screen.getByRole("heading", { name: "¿Qué plato y por qué?" })).toBeInTheDocument()
    expect(screen.getByText("Anular plato · #128 · Mesa 8")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Elegir quién autoriza" })).toBeDisabled()
    click("Uno más")
    expect(screen.getByRole("button", { name: "Uno más" })).toBeDisabled()
    pickReason("Plato devuelto")
    await toPin()

    typePin("135")
    expect(screen.getByRole("button", { name: "Autorizar" })).toBeDisabled()
    typePin("7")
    click("Autorizar")

    expect(await screen.findByRole("heading", { name: "Plato anulado" })).toBeInTheDocument()
    expect(auth.authorizeSupervisor).toHaveBeenCalledWith({
      pin: "1357",
      action: "void_item",
      profileId: "a",
      targetType: "order",
      targetId: "o-1",
    })
    expect(orders.voidOrderItems).toHaveBeenCalledWith("o-1", {
      items: [{ itemId: "l-1", quantity: 2 }],
      reason: "dish_returned",
      reasonText: null,
      authorizationId: "auth-1",
    })
    expect(screen.getByText("Nuevo total de la orden: $ 32.900.", { normalizer: (t) => t.replace(/\s+/g, " ") })).toBeInTheDocument()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("'Otro' needs its text before continuing", async () => {
    renderFlow(itemTarget)
    pickReason("Otro")
    expect(screen.getByText("Escribe el motivo para continuar.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Elegir quién autoriza" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Escribe el motivo (obligatorio)"), { target: { value: "Salió frío" } })
    expect(screen.getByRole("button", { name: "Elegir quién autoriza" })).toBeEnabled()
    await toPin()
    typePin("1357")
    click("Autorizar")
    await screen.findByRole("heading", { name: "Plato anulado" })
    expect(orders.voidOrderItems.mock.calls[0][1]).toMatchObject({ reason: "other", reasonText: "Salió frío" })
  })

  it("refuses the actor's own tile: 'Debe autorizar otra persona'", async () => {
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    click("Elegir quién autoriza")
    const own = await screen.findByRole("radio", { name: /Laura Gómez/ })
    expect(own).toHaveAttribute("aria-disabled", "true")
    expect(within(own).getByText("Cajero · eres tú")).toBeInTheDocument()
    fireEvent.click(own)
    expect(screen.getByRole("alert")).toHaveTextContent("Debe autorizar otra persona.")
    expect(screen.queryByRole("group", { name: "Teclado del PIN" })).not.toBeInTheDocument()
  })

  it("accepts the actor's own tile when the restaurant allows self-authorization", async () => {
    config.allowSelfAuthorization = true
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    click("Elegir quién autoriza")
    await waitFor(() => expect(screen.getByRole("radio", { name: /Laura Gómez/ })).not.toHaveAttribute("aria-disabled"))
    fireEvent.click(screen.getByRole("radio", { name: /Laura Gómez/ }))
    expect(await screen.findByRole("heading", { name: "Laura, escribe tu PIN" })).toBeInTheDocument()
  })

  it("a wrong PIN says so, clears the dots and voids nothing", async () => {
    auth.authorizeSupervisor.mockRejectedValue(new ApiError(403, "Forbidden", "PIN incorrecto", { code: "pin_invalid" }))
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    await toPin()
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByRole("alert")).toHaveTextContent("PIN incorrecto.")
    expect(screen.getByRole("img", { name: "0 de 4 a 6 dígitos" })).toBeInTheDocument()
    expect(orders.voidOrderItems).not.toHaveBeenCalled()
  })

  it("a locked PIN shows 'Bloqueado hasta hh:mm' from the supervisor's lockedUntil and locks the pad", async () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString()
    auth.authorizeSupervisor.mockRejectedValue(new ApiError(429, "Too Many Requests", "Demasiados intentos", { code: "pin_locked" }))
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    await toPin()
    loadSupervisors.mockResolvedValue([{ ...carlos, pinLockedUntil: until }, laura])
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByText(`Bloqueado hasta ${lockedUntilLabel(until)}.`)).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Teclado del PIN" })).getByRole("button", { name: "1" })).toBeDisabled()
    click("Elegir otro supervisor")
    expect(await screen.findByRole("heading", { name: "¿Quién autoriza?" })).toBeInTheDocument()
  })

  it("an expired authorization goes back to step 2 with nothing voided", async () => {
    orders.voidOrderItems.mockRejectedValue(
      new ApiError(403, "Forbidden", "La autorización no es válida", { code: "authorization_invalid" }),
    )
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    await toPin()
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByRole("heading", { name: "¿Quién autoriza?" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("La autorización venció.")
  })

  it("shows the API's Spanish refusal for any other code", async () => {
    orders.voidOrderItems.mockRejectedValue(
      new ApiError(422, "Unprocessable", "No puedes anular más unidades de las que tiene el producto", {
        code: "void_quantity_exceeded",
      }),
    )
    renderFlow(itemTarget)
    pickReason("Plato devuelto")
    await toPin()
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByRole("alert")).toHaveTextContent("No puedes anular más unidades de las que tiene el producto")
  })
})

describe("VoidFlow — cancelar orden y anular pago", () => {
  it("cancels the order with a cancel_order authorization for that order", async () => {
    renderFlow(orderTarget)
    expect(screen.getByRole("heading", { name: "¿Por qué se cancela?" })).toBeInTheDocument()
    pickReason("El cliente se fue")
    await toPin()
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByRole("heading", { name: "Orden cancelada" })).toBeInTheDocument()
    expect(auth.authorizeSupervisor.mock.calls[0][0]).toMatchObject({ action: "cancel_order", targetType: "order", targetId: "o-1" })
    expect(orders.cancelOrder).toHaveBeenCalledWith("o-1", { reason: "customer_left", reasonText: null, authorizationId: "auth-1" })
  })

  it("an order with nothing on it is cancelled without a supervisor", async () => {
    renderFlow({ ...orderTarget, lines: [], total: 0 })
    pickReason("Error del mesero")
    click("Cancelar orden")
    expect(await screen.findByRole("heading", { name: "Orden cancelada" })).toBeInTheDocument()
    expect(auth.authorizeSupervisor).not.toHaveBeenCalled()
    expect(orders.cancelOrder).toHaveBeenCalledWith("o-1", { reason: "waiter_error", reasonText: null })
  })

  it("voids the payment with a void_payment authorization bound to that payment", async () => {
    renderFlow(paymentTarget)
    expect(screen.getByRole("heading", { name: "¿Qué pago y por qué?" })).toBeInTheDocument()
    pickReason("Cobro duplicado")
    await toPin()
    typePin("1357")
    click("Autorizar")
    expect(await screen.findByRole("heading", { name: "Pago anulado" })).toBeInTheDocument()
    expect(auth.authorizeSupervisor.mock.calls[0][0]).toMatchObject({
      action: "void_payment",
      targetType: "payment",
      targetId: "p-2",
    })
    expect(payments.voidPayment).toHaveBeenCalledWith("p-2", {
      reason: "duplicate_charge",
      reasonText: null,
      authorizationId: "auth-1",
    })
  })

  it("tells a waiter to hand the phone to a supervisor", async () => {
    renderFlow(itemTarget, waiter)
    pickReason("Plato devuelto")
    click("Elegir quién autoriza")
    expect(await screen.findByText(/Pide a un supervisor que autorice/)).toBeInTheDocument()
    expect(await screen.findByRole("radio", { name: /Laura Gómez/ })).not.toHaveAttribute("aria-disabled")
  })
})
