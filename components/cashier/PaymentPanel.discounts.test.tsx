import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * S13: the panel charges the server's amount due (net subtotal + tax), never
 * the list prices of the lines; a fully discounted order is closed with one
 * cash tender of 0 and cash received 0.
 */

const payments = vi.hoisted(() => ({ listPaymentMethods: vi.fn(), payOrder: vi.fn() }))
vi.mock("@/lib/api/payments", async (importOriginal) => ({ ...(await importOriginal<object>()), ...payments }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: undefined }) }))
const tenders = vi.hoisted(() => ({ zeroTotalTenders: vi.fn() }))
vi.mock("@/lib/payments/tenders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/tenders")>()
  tenders.zeroTotalTenders.mockImplementation(actual.zeroTotalTenders)
  return { ...actual, zeroTotalTenders: tenders.zeroTotalTenders }
})
vi.mock("@/utils/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))

import { PaymentPanel, type PaymentOrderSource } from "./PaymentPanel"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import type { CashierBillSource } from "@/lib/cashier/orders"
import type { CashRegister } from "@/types/cash-register"
import { formatCurrency } from "@/utils/helpers"

/** Text without spaces: Money splits its own nodes and formatCurrency uses a no-break space. */
const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")

const CASH = { id: "cash-id", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 10 }

/** Mesa 7: $141.000 at list price, −$38.000 of discounts, tax 8 % on $103.000. */
function source(overrides: Partial<CashierBillSource> = {}): CashierBillSource {
  return {
    order_items: [
      { id: "i-1", name: "Mojito", price: 24000, quantity: 3 },
      { id: "i-2", name: "Margarita", price: 26000, quantity: 1 },
      { id: "i-3", name: "Hamburguesa clásica", price: 29000, quantity: 1 },
      { id: "i-4", name: "Tres leches", price: 14000, quantity: 1 },
    ],
    tax_percentage: 8,
    tip_percentage: 0,
    subtotal: 103000,
    tax: 8240,
    tip: 0,
    total_discounts: 38000,
    table_id: "t-7",
    waiter_id: "w-1",
    ...overrides,
  }
}

function renderPanel(order: PaymentOrderSource) {
  const onPaid = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const panel = (value: PaymentOrderSource) => (
    <QueryClientProvider client={client}>
      <PaymentPanel orderId="o-1" order={value} layout="dialog" onCancel={() => {}} onPaid={onPaid} />
    </QueryClientProvider>
  )
  const { rerender } = render(panel(order))
  return { onPaid, rerender: (value: PaymentOrderSource) => rerender(panel(value)) }
}

const result = (amountDue: number) => ({
  paymentId: "pay-1",
  status: "paid",
  amountDue,
  tipAmount: 0,
  totalCharged: amountDue,
  changeGiven: 0,
  drawerWarning: false,
  drawerCashBefore: 0,
  alreadyPaid: false,
  tenders: [{ lineNo: 1, methodCode: "cash", amount: amountDue, cashReceived: amountDue }],
})

beforeEach(() => {
  payments.listPaymentMethods.mockReset().mockResolvedValue([CASH])
  payments.payOrder.mockReset()
  useCashRegisterStore.setState({
    currentRegister: { id: "r-1", status: "open" } as unknown as CashRegister,
    isRegisterOpen: () => true,
  })
})

describe("PaymentPanel — discounts", () => {
  it("charges the server total with the discounts, not the list prices", async () => {
    renderPanel(source())
    const remaining = await screen.findByTestId("payment-remaining")
    expect(squash(remaining.textContent)).toBe(squash(formatCurrency(111240)))
    expect(squash(screen.getByRole("button", { name: /Registrar/ }).textContent)).toContain(squash(formatCurrency(111240)))
  })

  it("shows the discounts in the bill summary", async () => {
    renderPanel(source())
    const row = (await screen.findByText("Descuentos")).parentElement!
    expect(squash(row.textContent)).toBe(squash(`Descuentos −${formatCurrency(38000)}`))
    expect(squash(screen.getByText("Subtotal (precio de lista)").parentElement!.textContent)).toBe(
      squash(`Subtotal (precio de lista) ${formatCurrency(141000)}`),
    )
  })

  it("a fully discounted order is closed with one cash tender of 0", async () => {
    payments.payOrder.mockResolvedValue(result(0))
    const { onPaid } = renderPanel(source({ subtotal: 0, tax: 0, total_discounts: 141000 }))
    expect(await screen.findByText("La cuenta quedó en $0: se cierra sin cobro.")).toBeInTheDocument()
    const register = await screen.findByRole("button", { name: /Registrar/ })
    await waitFor(() => expect(register).toBeEnabled())
    fireEvent.click(register)

    await waitFor(() => expect(payments.payOrder).toHaveBeenCalledTimes(1))
    expect(payments.payOrder.mock.calls[0]![0]).toMatchObject({
      orderId: "o-1",
      tip: 0,
      tenders: [{ payment_method_id: "cash-id", amount: 0, cash_received: 0 }],
    })
    await waitFor(() => expect(onPaid).toHaveBeenCalled())
    expect(onPaid.mock.calls[0]![0].bill).toMatchObject({ subtotal: 0, total: 0, totalDiscounts: 141000 })
  })
})

describe("PaymentPanel — zero-total close (S5)", () => {
  it("is decided from the server bill: an order with an amount due never takes the zero path", async () => {
    tenders.zeroTotalTenders.mockClear()
    renderPanel(source())
    await screen.findByTestId("payment-remaining")
    expect(tenders.zeroTotalTenders).not.toHaveBeenCalled()
    expect(screen.queryByText(/La cuenta quedó en \$0/)).not.toBeInTheDocument()
  })
})

describe("PaymentPanel — invoice discounts (S14)", () => {
  const discount = (id: string, label: string, amount: number, orderItemId: string | null) => ({
    id,
    kind: orderItemId ? ("promotion_item" as const) : ("manual_bill" as const),
    source: orderItemId ? ("automatic" as const) : ("manual" as const),
    label,
    amount,
    promotionId: null,
    orderItemId,
    comboId: null,
    reason: null,
    authorizedBy: null,
  })

  async function pay(order: PaymentOrderSource, amountDue: number) {
    payments.payOrder.mockResolvedValue(result(amountDue))
    const { onPaid } = renderPanel(order)
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    const register = await screen.findByRole("button", { name: /Registrar/ })
    await waitFor(() => expect(register).toBeEnabled())
    fireEvent.click(register)
    await waitFor(() => expect(onPaid).toHaveBeenCalled())
    return onPaid.mock.calls[0]![0]
  }

  it("a paid order with a 2x1 and a bill discount carries both and the list-price subtotal", async () => {
    const invoice = await pay(
      {
        ...source(),
        discounts: [discount("od-1", "Happy hour 2x1", 24000, "i-1"), discount("od-2", "Cortesía", 14000, null)],
        gross_subtotal: 141000,
      },
      111240,
    )
    expect(invoice.bill.grossSubtotal).toBe(141000)
    expect(invoice.discounts).toEqual([{ label: "Cortesía", amount: 14000, orderItemId: null }])
    expect(invoice.items[0].discounts).toEqual([{ label: "Happy hour 2x1", amount: 24000, orderItemId: "i-1" }])
    expect("discounts" in invoice.items[1]).toBe(false)
  })

  it("an order without discounts builds the same invoice as before", async () => {
    const invoice = await pay(source({ subtotal: 141000, tax: 11280, total_discounts: 0 }), 152280)
    expect("discounts" in invoice).toBe(false)
    expect("grossSubtotal" in invoice.bill).toBe(false)
    expect(invoice.items.some((item: object) => "discounts" in item)).toBe(false)
    expect(invoice.bill).toEqual({ subtotal: 141000, tax: 11280, taxPercentage: 8, tip: 0, tipPercentage: 0, total: 152280, totalDiscounts: 0 })
  })

  it("re-seeds the amounts when the order's discounts change with the same total (S5)", async () => {
    const before: PaymentOrderSource = { ...source(), discounts: [discount("od-1", "Happy hour 2x1", 38000, "i-1")], gross_subtotal: 141000 }
    const after: PaymentOrderSource = { ...source(), discounts: [discount("od-9", "Cortesía", 38000, null)], gross_subtotal: 141000 }
    payments.payOrder.mockResolvedValue(result(111240))
    const { onPaid, rerender } = renderPanel(before)
    fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    rerender(after)
    expect(await screen.findByText(/vuelve a registrar los pagos/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Efectivo" }))
    fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
    const register = await screen.findByRole("button", { name: /Registrar/ })
    await waitFor(() => expect(register).toBeEnabled())
    fireEvent.click(register)
    await waitFor(() => expect(onPaid).toHaveBeenCalled())
    expect(onPaid.mock.calls[0]![0].discounts).toEqual([{ label: "Cortesía", amount: 38000, orderItemId: null }])
  })
})
