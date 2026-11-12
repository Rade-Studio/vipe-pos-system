import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"

/**
 * S13 (design/promociones/03, "Agregar cortesía o descuento"): promotion or
 * free discount, product or the whole bill, Motivo, and the void sheet's
 * supervisor PIN bound to apply_discount (none for a `manual` promotion).
 */

const auth = vi.hoisted(() => ({ authorizeSupervisor: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<object>()), ...auth }))
const discounts = vi.hoisted(() => ({ addOrderDiscount: vi.fn(), removeOrderDiscount: vi.fn() }))
vi.mock("@/lib/api/discounts", async (importOriginal) => ({ ...(await importOriginal<object>()), ...discounts }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))
vi.mock("@/lib/api/config", () => ({
  CONFIG_QUERY_KEY: ["config"],
  fetchConfig: async () => ({ allowSelfAuthorization: false }),
}))

import { DiscountSheet, type DiscountSheetTarget } from "./DiscountSheet"
import { promo } from "@/lib/cashier/discount-fixtures"
import type { Supervisor } from "@/components/voids/flow"

const carlos: Supervisor = { id: "a", fullName: "Carlos Pérez", role: "admin", hasPin: true, pinLockedUntil: null }
const cortesiaPin = promo({ id: "p-pin", name: "Cortesía de cumpleaños", mode: "manual_pin" })
const postreLibre = promo({ id: "p-free", name: "Postre de la casa", mode: "manual", sentence: "Sin PIN" })

const addTarget: DiscountSheetTarget = {
  mode: "add",
  label: "Mesa 7",
  billOrderId: "o-1",
  promotions: [cortesiaPin, postreLibre],
  lines: [
    { itemId: "i-mojito", orderId: "o-1", name: "Mojito", unitPrice: 24000, quantity: 2 },
    { itemId: "i-tres", orderId: "o-1", name: "Tres leches", unitPrice: 14000, quantity: 1 },
  ],
}

const authorization = {
  authorizationId: "auth-1",
  action: "apply_discount",
  targetType: "order",
  targetId: "o-1",
  supervisor: { id: "a", name: "Carlos Pérez" },
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
}

function renderSheet(target: DiscountSheetTarget, loadSupervisors: () => Promise<Supervisor[]> = async () => [carlos]) {
  const onApplied = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DiscountSheet target={target} onApplied={onApplied} onClose={onClose} loadSupervisors={loadSupervisors} />
    </QueryClientProvider>,
  )
  return { onApplied, onClose }
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const pick = (group: string, name: string | RegExp) =>
  fireEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name }))
const typeReason = (text: string) => fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: text } })
async function authorizeWithPin() {
  fireEvent.click(await screen.findByRole("radio", { name: /Carlos Pérez/ }))
  const pad = screen.getByRole("group", { name: "Teclado del PIN" })
  for (const digit of "1234") fireEvent.click(within(pad).getByRole("button", { name: digit }))
  fireEvent.click(within(pad).getByRole("button", { name: "Aplicar" }))
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
  auth.authorizeSupervisor.mockReset().mockResolvedValue(authorization)
  discounts.addOrderDiscount.mockReset().mockResolvedValue({ id: "o-1" })
  discounts.removeOrderDiscount.mockReset().mockResolvedValue({ id: "o-1" })
})

describe("DiscountSheet — add", () => {
  it("a manual_pin promotion asks the supervisor PIN for apply_discount and sends it with the body", async () => {
    const { onApplied, onClose } = renderSheet(addTarget)
    pick("Qué se aplica", /Cortesía de cumpleaños/)
    pick("Producto", /Tres leches/)
    typeReason("  Cumpleaños de Ana ")
    click("Autorizar y aplicar")
    await authorizeWithPin()

    await waitFor(() => expect(discounts.addOrderDiscount).toHaveBeenCalledTimes(1))
    expect(auth.authorizeSupervisor).toHaveBeenCalledWith({
      pin: "1234",
      action: "apply_discount",
      profileId: "a",
      targetType: "order",
      targetId: "o-1",
    })
    expect(discounts.addOrderDiscount).toHaveBeenCalledWith("o-1", {
      promotionId: "p-pin",
      orderItemId: "i-tres",
      reason: "Cumpleaños de Ana",
      authorizationId: "auth-1",
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it("a manual promotion applies without PIN", async () => {
    const { onApplied } = renderSheet(addTarget)
    pick("Qué se aplica", /Postre de la casa/)
    pick("Producto", /Tres leches/)
    typeReason("Cliente frecuente")
    click("Aplicar")

    await waitFor(() => expect(onApplied).toHaveBeenCalled())
    expect(auth.authorizeSupervisor).not.toHaveBeenCalled()
    expect(discounts.addOrderDiscount).toHaveBeenCalledWith("o-1", {
      promotionId: "p-free",
      orderItemId: "i-tres",
      reason: "Cliente frecuente",
    })
  })

  it("a free discount on the whole bill sends type and value, with PIN", async () => {
    renderSheet(addTarget)
    pick("Qué se aplica", /Descuento manual/)
    pick("Tipo de descuento", "Valor")
    fireEvent.change(screen.getByLabelText("Valor en pesos"), { target: { value: "5000" } })
    pick("Producto", "Toda la cuenta")
    typeReason("Demora en la cocina")
    click("Autorizar y aplicar")
    await authorizeWithPin()

    await waitFor(() =>
      expect(discounts.addOrderDiscount).toHaveBeenCalledWith("o-1", {
        discountType: "fixed_amount",
        discountValue: 5000,
        reason: "Demora en la cocina",
        authorizationId: "auth-1",
      }),
    )
  })

  it("checks the reason before asking for the PIN", () => {
    renderSheet(addTarget)
    pick("Qué se aplica", /Cortesía de cumpleaños/)
    pick("Producto", /Tres leches/)
    typeReason("ab")
    click("Autorizar y aplicar")
    expect(screen.getByText("Escribe al menos 3 letras.")).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "Quién autoriza" })).not.toBeInTheDocument()
  })

  it("a 422 shows the Spanish message and keeps the form", async () => {
    discounts.addOrderDiscount.mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", "x", { code: "promotion_max_uses" }),
    )
    const { onClose } = renderSheet(addTarget)
    pick("Qué se aplica", /Postre de la casa/)
    pick("Producto", /Tres leches/)
    typeReason("Cliente frecuente")
    click("Aplicar")

    expect(await screen.findByText("Esta promoción ya se usó el máximo de veces en la cuenta")).toBeInTheDocument()
    expect(screen.getByLabelText("Motivo")).toHaveValue("Cliente frecuente")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a 403 on the authorization asks who authorizes again, with the message", async () => {
    discounts.addOrderDiscount.mockRejectedValueOnce(
      new ApiError(403, "Forbidden", "x", { code: "authorization_invalid" }),
    )
    renderSheet(addTarget)
    pick("Qué se aplica", /Cortesía de cumpleaños/)
    pick("Producto", /Tres leches/)
    typeReason("Cumpleaños")
    click("Autorizar y aplicar")
    await authorizeWithPin()

    expect(await screen.findByText("La autorización venció o ya se usó. Escribe el PIN otra vez.")).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Quién autoriza" })).toBeInTheDocument()
  })
})

describe("DiscountSheet — remove", () => {
  const discount = {
    id: "d-cortesia",
    orderId: "o-1",
    label: "Cortesía de cumpleaños",
    amount: 14000,
    note: "Paula R. · PIN",
    manual: true,
    promotionId: "p-pin",
  }

  it("removes a manual discount with the apply_discount PIN", async () => {
    const { onApplied } = renderSheet({ mode: "remove", label: "Mesa 7", discount, requiresPin: true })
    click("Autorizar y quitar")
    fireEvent.click(await screen.findByRole("radio", { name: /Carlos Pérez/ }))
    const pad = screen.getByRole("group", { name: "Teclado del PIN" })
    for (const digit of "1234") fireEvent.click(within(pad).getByRole("button", { name: digit }))
    fireEvent.click(within(pad).getByRole("button", { name: "Quitar" }))

    await waitFor(() => expect(discounts.removeOrderDiscount).toHaveBeenCalledWith("o-1", "d-cortesia", "auth-1"))
    expect(auth.authorizeSupervisor).toHaveBeenCalledWith(expect.objectContaining({ action: "apply_discount", targetId: "o-1" }))
    await waitFor(() => expect(onApplied).toHaveBeenCalled())
  })

  it("a manual promotion's discount is removed without PIN", async () => {
    renderSheet({ mode: "remove", label: "Mesa 7", discount, requiresPin: false })
    click("Quitar descuento")
    await waitFor(() => expect(discounts.removeOrderDiscount).toHaveBeenCalledWith("o-1", "d-cortesia", undefined))
    expect(auth.authorizeSupervisor).not.toHaveBeenCalled()
  })
})

describe("DiscountSheet — never silent (S5)", () => {
  const discount = {
    id: "d-cortesia",
    orderId: "o-1",
    label: "Cortesía de cumpleaños",
    amount: 14000,
    note: "Paula R. · PIN",
    manual: true,
    promotionId: "p-pin",
  }

  it("says what to choose when nothing is chosen", () => {
    renderSheet(addTarget)
    typeReason("Cliente frecuente")
    click("Autorizar y aplicar")
    expect(screen.getByText("Elige qué se aplica.")).toBeInTheDocument()
    expect(discounts.addOrderDiscount).not.toHaveBeenCalled()
  })

  it("says to choose a product or the whole bill when the product is missing", () => {
    renderSheet(addTarget)
    pick("Qué se aplica", /Postre de la casa/)
    typeReason("Cliente frecuente")
    click("Aplicar")
    expect(screen.getByText("Elige un producto o Toda la cuenta.")).toBeInTheDocument()
    expect(discounts.addOrderDiscount).not.toHaveBeenCalled()
  })

  it("confirms an applied discount", async () => {
    const { onClose } = renderSheet(addTarget)
    pick("Qué se aplica", /Postre de la casa/)
    pick("Producto", /Tres leches/)
    typeReason("Cliente frecuente")
    click("Aplicar")
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith("Descuento aplicado")
  })

  it("confirms a removed discount", async () => {
    const { onClose } = renderSheet({ mode: "remove", label: "Mesa 7", discount, requiresPin: false })
    click("Quitar descuento")
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalledWith("Descuento quitado")
  })

  it("a stored discount whose refresh fails says the bill was not updated", async () => {
    const { onApplied, onClose } = renderSheet(addTarget)
    onApplied.mockRejectedValueOnce(new Error("offline"))
    pick("Qué se aplica", /Postre de la casa/)
    pick("Producto", /Tres leches/)
    typeReason("Cliente frecuente")
    click("Aplicar")
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalledWith("El descuento se guardó, pero la cuenta no se actualizó. Toca Reintentar.")
  })

  it("a refused removal shows the message and keeps the sheet", async () => {
    discounts.removeOrderDiscount.mockRejectedValueOnce(new Error("offline"))
    const { onClose } = renderSheet({ mode: "remove", label: "Mesa 7", discount, requiresPin: false })
    click("Quitar descuento")
    expect(await screen.findByText("No se pudo aplicar. Revisa la conexión e inténtalo de nuevo.")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a wrong PIN says so and applies nothing", async () => {
    auth.authorizeSupervisor.mockRejectedValueOnce(new ApiError(401, "Unauthorized", "x", { code: "pin_invalid" }))
    renderSheet(addTarget)
    pick("Qué se aplica", /Cortesía de cumpleaños/)
    pick("Producto", /Tres leches/)
    typeReason("Cumpleaños")
    click("Autorizar y aplicar")
    await authorizeWithPin()
    expect(await screen.findByText("PIN incorrecto.")).toBeInTheDocument()
    expect(discounts.addOrderDiscount).not.toHaveBeenCalled()
  })

  it("a failed read of who authorizes offers Reintentar", async () => {
    const load = vi.fn<() => Promise<Supervisor[]>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([carlos])
    renderSheet(addTarget, load)
    pick("Qué se aplica", /Cortesía de cumpleaños/)
    pick("Producto", /Tres leches/)
    typeReason("Cumpleaños")
    click("Autorizar y aplicar")
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }))
    expect(await screen.findByRole("radio", { name: /Carlos Pérez/ })).toBeInTheDocument()
  })
})
