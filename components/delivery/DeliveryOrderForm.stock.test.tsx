import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T12 (S3, S5) — delivery orders created through `create_delivery_order`
 * never deducted stock. After a successful creation the form asks the server
 * to consume the order (`consume_order_stock`); a failure of that call must
 * not undo or obstruct the creation.
 */

const env = vi.hoisted(() => ({
  createDeliveryOrder: vi.fn(),
  consumeOrderStock: vi.fn(),
  sendCommand: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
  createSupabaseClient: () => ({}),
}))

vi.mock("@/lib/supabase/service", () => ({
  categoryService: { getAllActive: async () => [{ id: "cat-1", name: "Platos", icon: null }] },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: {
    getByCategoryWithPromotions: async () => [{ id: "d-1", name: "Bandeja", price: 12000, category_id: "cat-1" }],
  },
}))

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, findCustomerByPhone: vi.fn(async () => null), createDeliveryOrder: env.createDeliveryOrder }
})

vi.mock("@/lib/supabase/inventory", () => ({ consumeOrderStock: env.consumeOrderStock }))

vi.mock("@/lib/supabase/realtime-service", () => ({ realtimeService: { sendCommand: env.sendCommand } }))

vi.mock("@/hooks/use-toast", () => ({ toast: env.toast }))

import { DeliveryOrderForm } from "@/components/delivery/DeliveryOrderForm"

const created = {
  orderId: "o-del-1",
  customerId: "c-1",
  addressId: null,
  delivery: {
    orderId: "o-del-1",
    customerName: "Luis",
    customerPhone: "3001234567",
    addressSnapshot: { addressLine: "Calle 1 # 2-3", neighborhood: null, reference: null, label: null },
    paymentMode: "prepaid",
    cashChangeFor: null,
    notes: null,
  },
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
  fireEvent.click(await screen.findByText("Bandeja"))
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Crear domicilio" }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  env.createDeliveryOrder.mockResolvedValue(created)
  env.consumeOrderStock.mockResolvedValue({ orderId: "o-del-1", enabled: true, consumedItems: 1, totalCost: 0, shortages: [] })
})

describe("DeliveryOrderForm — sale stock consumption (T12)", () => {
  it("consumes the stock of the new order once after a successful creation", async () => {
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() => expect(env.consumeOrderStock).toHaveBeenCalledTimes(1))
    expect(env.consumeOrderStock).toHaveBeenCalledWith("o-del-1")
    expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(env.toast.success).toHaveBeenCalledWith("Domicilio creado y enviado a cocina")
    expect(env.toast.error).not.toHaveBeenCalled()
  })

  it("keeps the creation when the stock consumption fails", async () => {
    env.consumeOrderStock.mockRejectedValue(new Error("boom"))
    const onSubmitted = vi.fn()
    await fillAndSubmit(onSubmitted)

    await waitFor(() =>
      expect(env.toast.warning).toHaveBeenCalledWith(
        "El domicilio se creó, pero hubo un error al actualizar el inventario.",
      ),
    )
    expect(env.createDeliveryOrder).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(env.toast.success).toHaveBeenCalledWith("Domicilio creado y enviado a cocina")
    expect(env.toast.error).not.toHaveBeenCalled()
  })

  it("does not consume stock when the creation fails", async () => {
    env.createDeliveryOrder.mockRejectedValue(new Error("nope"))
    await fillAndSubmit(vi.fn())

    await waitFor(() => expect(env.toast.error).toHaveBeenCalled())
    expect(env.consumeOrderStock).not.toHaveBeenCalled()
  })
})
