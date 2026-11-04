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

const fetchConfig = vi.hoisted(() => vi.fn())

// T7b: the suggested fee is `deliveryDefaultFee` of the shared `GET /config` query.
vi.mock("@/lib/api/config", () => ({ CONFIG_QUERY_KEY: ["config"], fetchConfig }))

vi.mock("@/lib/api/catalog", () => ({
  fetchCategories: async () => [],
  fetchDishes: async () => [],
}))

vi.mock("@/lib/api/realtime", () => ({ realtimeService: { subscribeToDeliveries: () => () => {} } }))

vi.mock("@/lib/api/delivery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/delivery")>("@/lib/api/delivery")
  return { ...actual, listActiveDeliveries: vi.fn(async () => []), findCustomerByPhone: vi.fn(async () => null) }
})

vi.mock("@/lib/api/print", () => ({
  sendCommand: vi.fn(),
  sendFactura: vi.fn(),
}))

import { NewDeliveryDialog } from "@/components/delivery/NewDeliveryDialog"

let resolveConfig: ((value: { deliveryDefaultFee: number }) => void) | null = null
const resolveFee = (fee: number) => resolveConfig?.({ deliveryDefaultFee: fee })

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
  fetchConfig.mockReset()
  resolveConfig = null
  fetchConfig.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveConfig = resolve
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
      resolveFee(5000)
    })

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    expect(fetchConfig).toHaveBeenCalledTimes(1)
  })

  it("keeps a fee the operator typed while the read was in flight", async () => {
    renderDialog(makeClient())

    fireEvent.change(screen.getByLabelText("Domicilio"), { target: { value: "2500" } })

    await act(async () => {
      resolveFee(5000)
    })

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("2500"))
  })

  it("caches the suggested fee: a second open does not read it again", async () => {
    const client = makeClient()
    const first = renderDialog(client)
    await act(async () => {
      resolveFee(5000)
    })
    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    first.unmount()

    renderDialog(client)

    await waitFor(() => expect(screen.getByLabelText("Domicilio")).toHaveValue("5000"))
    expect(fetchConfig).toHaveBeenCalledTimes(1)
  })
})