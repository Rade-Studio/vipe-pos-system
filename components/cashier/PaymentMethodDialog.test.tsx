import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * S2: the delivery payment dialog builds the invoice like PaymentPanel does:
 * the order's bill discounts, `bill.grossSubtotal` and each item's
 * discounts; an order without discounts builds the same payload as before.
 */

const payments = vi.hoisted(() => ({ listPaymentMethods: vi.fn(), payOrder: vi.fn() }))
vi.mock("@/lib/api/payments", async (importOriginal) => ({ ...(await importOriginal<object>()), ...payments }))
const orders = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<object>()), ...orders }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: undefined }) }))
vi.mock("@/utils/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
const printed = vi.hoisted(() => ({ invoices: [] as unknown[] }))
vi.mock("@/components/printing/InvoicePrintView", () => ({
  InvoicePrintView: ({ invoice }: { invoice: unknown }) => {
    printed.invoices.push(invoice)
    return <p>Factura lista</p>
  },
}))

import { PaymentMethodDialog } from "./PaymentMethodDialog"
import { mesa7 } from "@/lib/cashier/discount-fixtures"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { toOrder, type OrderDto } from "@/lib/api/orders"
import { billSourceFromOrder } from "@/lib/cashier/orders"
import type { PaymentOrderSource } from "@/lib/payments/invoice-discounts"
import type { CashRegister } from "@/types/cash-register"

const CASH = { id: "cash-id", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 10 }

/** Mesa 7 as a delivery, plus a $5.000 courtesy on the whole bill. */
function delivered(): OrderDto {
  const dto = mesa7()
  const bill = { ...dto.discounts[1]!, id: "d-bill", kind: "manual_bill" as const, label: "Demora", amount: 5000, orderItemId: null }
  return { ...dto, orderType: "delivery", tableId: null, tipPercentage: 0, subtotal: 98000, tax: 7840, total: 105840, totalDiscounts: 43000, discounts: [...dto.discounts, bill] }
}

function plain(): OrderDto {
  const dto = mesa7()
  return {
    ...dto,
    orderType: "delivery",
    tableId: null,
    tipPercentage: 0,
    subtotal: 141000,
    tax: 11280,
    total: 152280,
    totalDiscounts: 0,
    grossSubtotal: 141000,
    discounts: [],
    items: dto.items.map((item) => ({ ...item, discounts: [] })),
  }
}

async function payDelivery(dto: OrderDto, amountDue: number, held?: PaymentOrderSource) {
  orders.getById.mockResolvedValue(dto)
  payments.payOrder.mockResolvedValue({
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PaymentMethodDialog open onOpenChange={() => {}} orderId="o-1" order={held} deliveryFee={0} onSuccess={() => {}} />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole("button", { name: "Efectivo" }))
  fireEvent.click(await screen.findByRole("button", { name: /Usar restante/ }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar línea" }))
  const register = await screen.findByRole("button", { name: /Registrar/ })
  await waitFor(() => expect(register).toBeEnabled())
  fireEvent.click(register)
  await screen.findByText("Factura lista")
  return printed.invoices.at(-1) as {
    bill: Record<string, number>
    discounts?: unknown
    items: { id: string; discounts?: unknown }[]
  }
}

beforeEach(() => {
  printed.invoices = []
  payments.listPaymentMethods.mockReset().mockResolvedValue([CASH])
  payments.payOrder.mockReset()
  orders.getById.mockReset()
  useCashRegisterStore.setState({
    currentRegister: { id: "r-1", status: "open" } as unknown as CashRegister,
    isRegisterOpen: () => true,
  })
})

describe("PaymentMethodDialog — delivery invoice (S2)", () => {
  it("prints the bill discounts, the list-price subtotal and each item's discounts", async () => {
    const invoice = await payDelivery(delivered(), 105840)
    expect(invoice.bill.grossSubtotal).toBe(141000)
    expect(invoice.bill.totalDiscounts).toBe(43000)
    expect(invoice.discounts).toEqual([{ label: "Demora", amount: 5000, orderItemId: null }])
    expect(invoice.items.find((item) => item.id === "o-1-mojito")!.discounts).toEqual([
      { label: "Happy hour 2x1", amount: 24000, orderItemId: "o-1-mojito" },
    ])
    expect(invoice.items.find((item) => item.id === "o-1-tres")!.discounts).toEqual([
      { label: "Cortesía de cumpleaños", amount: 14000, orderItemId: "o-1-tres" },
    ])
    expect("discounts" in invoice.items.find((item) => item.id === "o-1-margarita")!).toBe(false)
  })

  it("an order the caller holds keeps its discounts on the invoice, with no read", async () => {
    const dto = delivered()
    const held: PaymentOrderSource = { ...billSourceFromOrder(toOrder(dto)), discounts: dto.discounts, gross_subtotal: dto.grossSubtotal }
    const invoice = await payDelivery(dto, 105840, held)
    expect(orders.getById).not.toHaveBeenCalled()
    expect(invoice.bill.grossSubtotal).toBe(141000)
    expect(invoice.discounts).toEqual([{ label: "Demora", amount: 5000, orderItemId: null }])
  })

  it("an order without discounts builds the same payload as before", async () => {
    const invoice = await payDelivery(plain(), 152280)
    expect("discounts" in invoice).toBe(false)
    expect(invoice.items.some((item) => "discounts" in item)).toBe(false)
    expect(invoice.bill).toEqual({ subtotal: 141000, tax: 11280, taxPercentage: 8, tip: 0, tipPercentage: 0, total: 152280, totalDiscounts: 0 })
  })
})
