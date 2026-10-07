import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T10 (S2) — "Nuevo domicilio" used to render NOTHING until the suggested
 * fee read resolved (`open && feeLoaded && <DeliveryOrderForm/>`), and it read
 * the value again on every single open through a `useEffect` + local state,
 * so it was never cached: every open of the dialog was a blank panel plus a
 * request.
 *
 * The form must be on screen immediately and the suggested fee must land in
 * the draft once it arrives — without overwriting a fee the operator already
 * typed.
 */

const getConfigValue = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/client", () => ({
  supabase: { channel: () => ({ on: () => ({ on: () => ({ subscribe: () => ({}) }) }) }), from: () => ({}), rpc: async () => ({ data: null, error: null }) },
  createSupabaseClient: () => ({}),
}))

vi.mock("@/lib/supabase/business-config-service", () => ({
  businessConfigService: { getConfigValue },
  default: { getConfigValue },
}))

vi.mock("@/lib/supabase/service", () => ({
  categoryService: { getAllActive: async () => [] },
  orderService: { getById: async () => ({}) },
}))

vi.mock("@/lib/supabase/dish-service-with-promotions", () => ({
  dishServiceWithPromotions: { getByCategoryWithPromotions: async () => [] },
}))

vi.mock("@/lib/supabase/delivery-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/delivery-service")>(
    "@/lib/supabase/delivery-service",
  )
  return { ...actual, listActiveDeliveries: vi.fn(async () => []), findCustomerByPhone: vi.fn(async () => null) }
})

vi.mock("@/lib/supabase/realtime-service", () => ({
  realtimeService: { sendCommand: vi.fn() },
}))

import { NewDeliveryDialog } from "@/components/delivery/NewDeliveryDialog"

let resolveFee: ((value: string | null) => void) | null = null

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
}

function renderDialog(client: QueryClient) {
  const onOpenChange = vi.fn()
  const view = render(
    <QueryClientProvider client={client}>
      <NewDeliveryDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  )
  return { ...view, onOpenChange }
}

beforeEach(() => {
  getConfigValue.mockReset()
  resolveFee = null
  getConfigValue.mockImplementation(
    () =>
      new Promise<string | null>((resolve) => {
        resolveFee = resolve
      }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("NewDeliveryDialog — no blank form while the suggested fee loads", () => {
  it("renders the form on open and seeds the suggested fee when the read resolves", async () => {
    renderDialog(makeClient())

    // The fee read is still in flight: the operator must already see the form.
    expect(screen.getByLabelText("Teléfono")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Crear domicilio" })).toBeInTheDocument()

    await act(async () => {
      resolveFee?.("5000")
    })

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    expect(getConfigValue).toHaveBeenCalledTimes(1)
    expect(getConfigValue).toHaveBeenCalledWith("delivery_default_fee")
  })

  it("keeps a fee the operator typed while the read was in flight", async () => {
    renderDialog(makeClient())

    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "2500" } })

    await act(async () => {
      resolveFee?.("5000")
    })

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("2500"))
  })

  it("caches the suggested fee: a second open does not read it again", async () => {
    const client = makeClient()
    const first = renderDialog(client)
    await act(async () => {
      resolveFee?.("5000")
    })
    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    first.unmount()

    renderDialog(client)

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    expect(getConfigValue).toHaveBeenCalledTimes(1)
  })
})