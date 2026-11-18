import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** H-065 (retry after a failed payment) and H-066 (Spanish payment errors). */

const payments = vi.hoisted(() => ({ listPaymentMethods: vi.fn(), payOrder: vi.fn() }))
vi.mock("@/lib/api/payments", async (importOriginal) => ({ ...(await importOriginal<object>()), ...payments }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: undefined }) }))
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast: toastMock }))

import { PaymentPanel, type PaymentOrderSource } from "./PaymentPanel"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { PaymentServiceError } from "@/lib/payments/types"
import type { CashRegister } from "@/types/cash-register"
import { formatCurrency } from "@/utils/helpers"

/** Text without spaces: formatCurrency uses a no-break space. */
const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")

const CASH = { id: "cash-id", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 10 }
const NEQUI = { id: "nequi-id", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 20 }

const order: PaymentOrderSource = {
  order_items: [{ id: "i-1", name: "Bandeja", price: 23652, quantity: 1 }],
  tax_percentage: 0,
  tip_percentage: 0,
  subtotal: 23652,
  tax: 0,
  tip: 0,
  total_discounts: 0,
  table_id: "t-1",
  waiter_id: "w-1",
} as PaymentOrderSource

const paid = {
  paymentId: "pay-1",
  status: "paid",
  amountDue: 23652,
  tipAmount: 0,
  totalCharged: 23652,
  changeGiven: 0,
  drawerWarning: false,
  drawerCashBefore: 0,
  alreadyPaid: false,
  tenders: [{ lineNo: 1, methodCode: "cash", amount: 23652, cashReceived: 23652 }],
}

function renderPanel() {
  const onPaid = vi.fn()
  const onCancel = vi.fn()
  const onBillStale = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PaymentPanel
        orderId="o-1"
        order={order}
        layout="dialog"
        onCancel={onCancel}
        onPaid={onPaid}
        onBillStale={onBillStale}
      />
    </QueryClientProvider>,
  )
  return { onPaid, onCancel, onBillStale }
}

async function addCashLine() {
  fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
  fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
}

beforeEach(() => {
  payments.listPaymentMethods.mockReset().mockResolvedValue([CASH, NEQUI])
  payments.payOrder.mockReset()
  Object.values(toastMock).forEach((fn) => fn.mockReset())
  useCashRegisterStore.setState({
    currentRegister: { id: "r-1", status: "open" } as unknown as CashRegister,
    isRegisterOpen: () => true,
  })
})

describe("PaymentPanel — retry after a failed payment (H-065)", () => {
  it("re-enables Registrar after a network error and retries with the same key", async () => {
    payments.payOrder
      .mockRejectedValueOnce(new PaymentServiceError({ kind: "unknown", message: "Failed to fetch" }))
      .mockResolvedValueOnce({ ...paid, status: "already_paid", alreadyPaid: true })
    const { onPaid } = renderPanel()
    await addCashLine()
    const register = await screen.findByRole("button", { name: /Registrar/ })
    await waitFor(() => expect(register).toBeEnabled())
    fireEvent.click(register)

    expect(await screen.findByRole("alert")).toHaveTextContent("Intenta de nuevo")
    await waitFor(() => expect(screen.getByRole("button", { name: /Registrar/ })).toBeEnabled())
    expect(onPaid).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Registrar/ }))
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(payments.payOrder).toHaveBeenCalledTimes(2)
    const [first, second] = payments.payOrder.mock.calls.map((call) => call[0])
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(second.tenders).toEqual(first.tenders)
    expect(toastMock.success).toHaveBeenCalledWith("Pago registrado. Esta orden ya estaba pagada; se muestra su factura.")
  })
})

describe("PaymentPanel — Spanish payment errors (H-066)", () => {
  it("says in Spanish that an electronic line cannot exceed the balance", async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole("button", { name: "Nequi" }))
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "30000" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))

    const issue = await screen.findByText(/no puede superar el saldo/)
    expect(squash(issue.textContent)).toBe(squash(`Nequi no puede superar el saldo (${formatCurrency(23652)})`))
    expect(screen.queryByText(/overpays/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Registrar/ })).toBeDisabled()
  })

  it("an order already paid elsewhere says so in Spanish, closes and refreshes", async () => {
    payments.payOrder.mockRejectedValue(
      new PaymentServiceError({ kind: "rejected", message: "pay_order: order o-1 is already paid" }),
    )
    const { onPaid, onCancel, onBillStale } = renderPanel()
    await addCashLine()
    const register = await screen.findByRole("button", { name: /Registrar/ })
    await waitFor(() => expect(register).toBeEnabled())
    fireEvent.click(register)

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    expect(onBillStale).toHaveBeenCalledTimes(1)
    expect(toastMock.error).toHaveBeenCalledWith("Esta orden ya fue cobrada en otra caja/pestaña")
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringMatching(/already paid/))
    expect(onPaid).not.toHaveBeenCalled()
  })
})
