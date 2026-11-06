import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T11 (S3, S4) — the delivery creation is ONE request: `POST /delivery/orders`
 * runs `create_delivery_order`, `consume_order_stock` and the kitchen command
 * in one server transaction. The form no longer sends the command or consumes
 * stock itself; a stock shortage keeps the order and comes back in
 * `consumption.shortages`, which the form reports as a warning.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  consumeOrderStock: vi.fn(),
  sendCommand: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api/catalog", async () => {
  const { menuCategory, menuDish } = await import("@/lib/order-steps/fixtures")
  return {
    getMenuTree: async () => ({
      categories: [menuCategory({ id: "cat-1", name: "Platos", dishes: [menuDish({ id: "d-1", name: "Bandeja", price: 12000 })] })],
    }),
    fetchDishes: async () => [],
  }
})

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, findCustomerByPhone: vi.fn(async () => null), createDeliveryOrder: env.createDeliveryOrder }
})

vi.mock("@/lib/api/inventory", () => ({ consumeOrderStock: env.consumeOrderStock }))

vi.mock("@/lib/api/print", () => ({ sendCommand: env.sendCommand }))

vi.mock("@/hooks/use-toast", () => ({ toast: env.toast, useToast: () => ({ toast: vi.fn() }) }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"
import { DeliveryServiceError } from "@/lib/api/delivery"

const created = {
  orderId: "o-del-1",
  customerId: "c-1",
  addressId: null,
  delivery: {
    orderId: "o-del-1",
    customerName: "Luis",
    customerPhone: "3001234567",
    addressSnapshot: { addressLine: "Calle 1 # 2-3", neighborhood: null, reference: null, label: null },
    addressLine: "Calle 1 # 2-3",
    neighborhood: null,
    addressReference: null,
    deliveryFee: 0,
    paymentMode: "prepaid",
    cashChangeFor: null,
    notes: null,
  },
  consumption: { orderId: "o-del-1", enabled: true, consumedItems: 1, totalCost: 0, shortages: [] },
  printJob: { id: "p-1", kind: "command", createdAt: "2026-11-04T12:00:00.000Z" },
}

async function fillAndSubmit(onSubmitted: () => void) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeliveryOrderForm suggestedFee={0} taxPct={0} onSubmitted={onSubmitted} />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "3001234567" } })
  await act(async () => {
    fireEvent.blur(screen.getByLabelText("Teléfono"))
  })
  fireEvent.change(await screen.findByLabelText("Nombre del cliente"), { target: { value: "Luis" } })
  fireEvent.change(await screen.findByLabelText("Dirección"), { target: { value: "Calle 1 # 2-3" } })
  // T11: products are added through the step picker.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Productos/ }))
  })
  fireEvent.click(await screen.findByRole("button", { name: /^Platos/ }))
  fireEvent.click(await screen.findByRole("button", { name: /^Bandeja/ }))
  fireEvent.click(await screen.findByRole("button", { name: "Agregar 1 Bandeja al pedido" }))
  // T12: the submit lives on the Confirmar step.
  fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Crear domicilio" }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  env.createDeliveryOrder.mockResolvedValue(created)
})

describe("DeliveryOrderForm — one transactional create (T11)", () => {
  it("sends one create with the draft and nothing else: no client command, no client stock consumption", async () => {
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1)
    expect(env.createDeliveryOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: { phone: "3001234567", name: "Luis" },
        address: expect.objectContaining({ addressLine: "Calle 1 # 2-3" }),
        items: [expect.objectContaining({ dishId: "d-1", quantity: 1 })],
      }),
    )
    expect(env.sendCommand).not.toHaveBeenCalled()
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
    expect(env.toast.success).toHaveBeenCalledWith("Domicilio creado y enviado a cocina")
    expect(env.toast.warning).not.toHaveBeenCalled()
    expect(env.toast.error).not.toHaveBeenCalled()
  })

  it("keeps the creation and warns with the shortages the server reported", async () => {
    env.createDeliveryOrder.mockResolvedValue({
      ...created,
      consumption: {
        ...created.consumption,
        shortages: [
          { itemId: "i-1", name: "Arroz", unit: "g", missing: 250 },
          { itemId: "i-2", name: "Huevo", unit: "", missing: 2 },
        ],
      },
    })
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(env.toast.warning).toHaveBeenCalledWith(
      "El domicilio se creó y se envió a cocina, pero hay stock insuficiente: Arroz (faltan 250 g), Huevo (faltan 2).",
    )
    expect(env.toast.success).not.toHaveBeenCalled()
    expect(env.toast.error).not.toHaveBeenCalled()
    expect(env.sendCommand).not.toHaveBeenCalled()
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
  })

  it("shows the error and keeps the form open when the creation fails", async () => {
    env.createDeliveryOrder.mockRejectedValue(new Error("nope"))
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() => expect(env.toast.error).toHaveBeenCalled())
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
    expect(env.sendCommand).not.toHaveBeenCalled()
  })

  it("shows the generic message for an unknown rollback (500) and keeps the form open", async () => {
    env.createDeliveryOrder.mockRejectedValue(
      new DeliveryServiceError({ kind: "unknown", message: "Internal server error" }),
    )
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() =>
      expect(env.toast.error).toHaveBeenCalledWith("Ocurrió un error al crear el domicilio. Intenta de nuevo."),
    )
    expect(env.toast.success).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Crear domicilio" })).toBeInTheDocument()
  })

  it("shows the server message verbatim for a rejected rollback (P0001) and keeps the form open", async () => {
    const message = "create_delivery_order: dish d-1 is not available"
    env.createDeliveryOrder.mockRejectedValue(new DeliveryServiceError({ kind: "rejected", message }))
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() => expect(env.toast.error).toHaveBeenCalledWith(message))
    expect(env.toast.success).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Crear domicilio" })).toBeInTheDocument()
  })
})
