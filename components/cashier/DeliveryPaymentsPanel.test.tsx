import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T10 (S1/S2) — the cashier panel that lists deliveries still owing money.
 *
 * It mounts `useActiveDeliveries` (so it shares the board's subscription after
 * this task) and, before this task, ran the FULL open-register load on mount
 * and again on every "Cobrar" click: three requests each time for a screen
 * that only needs to know whether a register is open.
 */

const harness = vi.hoisted(() => {
  const supabase = {
    channel: () => ({ on: () => ({ on: () => ({ subscribe: () => ({}) }) }), __name: "delivery" }),
    removeChannel: () => {},
    from: () => ({}),
    rpc: async () => ({ data: null, error: null }),
  }
  return { supabase }
})

vi.mock("@/lib/supabase/client", () => ({
  supabase: harness.supabase,
  createSupabaseClient: () => ({}),
}))

const listActiveDeliveries = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, listActiveDeliveries }
})

const getCurrentRegister = vi.hoisted(() => vi.fn())
const getOpenRegister = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: { getCurrentRegister, getOpenRegister },
}))

vi.mock("@/lib/supabase/service", () => ({
  categoryService: { getAllActive: async () => [] },
  orderService: { getById: () => new Promise(() => {}) },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: { getByCategoryWithPromotions: async () => [] },
}))

vi.mock("@/lib/supabase/payments-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/payments-service")>(
    "@/lib/supabase/payments-service",
  )
  return { ...actual, listPaymentMethods: async () => [], payOrder: async () => ({}) }
})

const toastError = vi.hoisted(() => vi.fn())

vi.mock("@/utils/toast", () => ({
  toast: { error: toastError, success: vi.fn(), warning: vi.fn() },
}))

import { DeliveryPaymentsPanel } from "@/components/cashier/DeliveryPaymentsPanel"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { parseOrderDeliveryRow } from "@/lib/delivery/parse"
import type { CashRegister } from "@/types/cash-register"

const openRegister = {
  id: "r-1",
  openingTimestamp: new Date("2026-10-07T08:00:00.000Z"),
  initialCash: 100_000,
  status: "open",
  transactions: [],
  cashTransactions: [],
} as unknown as CashRegister

function pendingRow() {
  return {
    delivery: parseOrderDeliveryRow({
      order_id: "d-1",
      customer_id: "c-1",
      customer_name: "Ana Ruiz",
      customer_phone: "3101234567",
      address_line: "Calle 5 # 10-20",
      neighborhood: "Lacentro",
      address_reference: null,
      delivery_fee: 3000,
      payment_mode: "cash_on_delivery",
      cash_change_for: null,
      courier_id: null,
      delivery_status: "out_for_delivery",
      failure_reason: null,
      notes: null,
      dispatched_at: "2026-10-07T10:30:00.000Z",
      delivered_at: null,
      failed_at: null,
      cancelled_at: null,
      created_at: "2026-10-07T10:00:00.000Z",
      updated_at: "2026-10-07T10:30:00.000Z",
    }),
    amountDue: 19_000,
    subtotal: 19_000,
    tax: 0,
    isPaid: false,
  }
}

beforeEach(() => {
  listActiveDeliveries.mockReset()
  getCurrentRegister.mockReset()
  getOpenRegister.mockReset()
  toastError.mockReset()
  listActiveDeliveries.mockResolvedValue([pendingRow()])
  getOpenRegister.mockResolvedValue(openRegister)
  getCurrentRegister.mockResolvedValue(openRegister)
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DeliveryPaymentsPanel — register open check", () => {
  it("asks only for the open register on mount and on every Cobrar click", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <DeliveryPaymentsPanel />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())

    expect(getOpenRegister).toHaveBeenCalledTimes(1)
    expect(getCurrentRegister).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /cobrar/i }))

    await waitFor(() =>
      expect(screen.getByText("Cargando información de la orden...")).toBeInTheDocument(),
    )
    expect(getOpenRegister).toHaveBeenCalledTimes(2)
    expect(getCurrentRegister).not.toHaveBeenCalled()
  })

  it("blocks the payment when no register is open", async () => {
    getOpenRegister.mockResolvedValue(null)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <DeliveryPaymentsPanel />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText("Ana Ruiz")).toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: /cobrar/i }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Debe abrir la caja antes de procesar pagos"),
    )
    expect(screen.queryByText("Cargando información de la orden...")).not.toBeInTheDocument()
  })
})