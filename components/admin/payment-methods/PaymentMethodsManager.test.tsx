import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T9 (S4) — the reorder is ONE atomic `PUT /payments/methods/order` with every
 * method id in the new order (the server refuses a partial list), not one
 * UPDATE per moved row.
 */

const payments = vi.hoisted(() => ({
  listPaymentMethods: vi.fn(),
  createPaymentMethod: vi.fn(),
  updatePaymentMethod: vi.fn(),
  reorderPaymentMethods: vi.fn(),
}))
vi.mock("@/lib/api/payments", () => payments)
vi.mock("@/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { PaymentMethodsManager } from "./PaymentMethodsManager"

const methods = [
  { id: "m-cash", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 0 },
  { id: "m-nequi", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 1 },
  { id: "m-card", code: "card", name: "Tarjeta", kind: "electronic", isActive: true, sortOrder: 2 },
]

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PaymentMethodsManager />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(payments)) fn.mockReset()
  payments.listPaymentMethods.mockResolvedValue(methods)
  payments.reorderPaymentMethods.mockResolvedValue([])
})

describe("PaymentMethodsManager reorder", () => {
  it("sends the whole ordered id list once", async () => {
    renderManager()
    await screen.findByText("Tarjeta")

    fireEvent.click(screen.getAllByRole("button", { name: "Bajar" })[0])

    await waitFor(() => expect(payments.reorderPaymentMethods).toHaveBeenCalledTimes(1))
    expect(payments.reorderPaymentMethods).toHaveBeenCalledWith(["m-nequi", "m-cash", "m-card"])
  })
})

describe("PaymentMethodsManager locked switch (H-017)", () => {
  it("explains why the last active cash method cannot be turned off", async () => {
    renderManager()
    await screen.findByText("Tarjeta")
    const [cashSwitch, nequiSwitch] = screen.getAllByRole("switch")
    expect(cashSwitch).toBeDisabled()
    expect(cashSwitch).toHaveAccessibleDescription(
      "Debe quedar al menos un método de pago en efectivo activo para dar cambio.",
    )
    expect(screen.getByText("Debe quedar al menos un método de pago en efectivo activo para dar cambio.")).toBeVisible()
    expect(nequiSwitch).toBeEnabled()
    expect(nequiSwitch).not.toHaveAccessibleDescription()
  })

  it("explains why the only active method cannot be turned off", async () => {
    payments.listPaymentMethods.mockResolvedValue([
      { id: "m-cash", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 0 },
      { id: "m-nequi", code: "nequi", name: "Nequi", kind: "electronic", isActive: false, sortOrder: 1 },
    ])
    renderManager()
    await screen.findByText("Nequi")
    const [cashSwitch] = screen.getAllByRole("switch")
    expect(cashSwitch).toHaveAccessibleDescription("Debe quedar al menos un método de pago activo para poder cobrar.")
  })
})
