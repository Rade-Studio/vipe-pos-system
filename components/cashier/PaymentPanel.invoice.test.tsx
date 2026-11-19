import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * H-014 / S2 (odd/tasks/qa-noviembre-2026.md T12): the invoice of a payment
 * carries the consecutive the server assigned and the DIAN lines of its fiscal
 * snapshot; the range and validity notices are warnings, the payment is done.
 */

const payments = vi.hoisted(() => ({ listPaymentMethods: vi.fn(), payOrder: vi.fn() }))
vi.mock("@/lib/api/payments", async (importOriginal) => ({ ...(await importOriginal<object>()), ...payments }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: undefined }) }))
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast: toasts }))

import { PaymentPanel } from "./PaymentPanel"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import type { CashierBillSource } from "@/lib/cashier/orders"
import type { CashRegister } from "@/types/cash-register"

const CASH = { id: "cash-id", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 10 }
/** A fully discounted order: the zero-total close pays it in one click. */
const ORDER: CashierBillSource = {
  order_items: [{ id: "i-1", name: "Arepa", price: 10000, quantity: 1 }],
  tax_percentage: 0,
  tip_percentage: 0,
  subtotal: 0,
  tax: 0,
  tip: 0,
  total_discounts: 10000,
  table_id: "t-1",
  waiter_id: "w-1",
}
const FISCAL = {
  prefix: "POS",
  resolution: "18764000001234",
  rangeFrom: 1,
  rangeTo: 5000,
  validFrom: "2026-01-01",
  validTo: "2027-12-31",
  taxRegime: "responsable_iva" as const,
}
const paid = (extra: object = {}) => ({
  paymentId: "pay-1",
  status: "paid",
  amountDue: 0,
  tipAmount: 0,
  totalCharged: 0,
  changeGiven: 0,
  drawerWarning: false,
  drawerCashBefore: 0,
  alreadyPaid: false,
  tenders: [{ lineNo: 1, methodCode: "cash", amount: 0, cashReceived: 0 }],
  ...extra,
})

async function payOnce() {
  const onPaid = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PaymentPanel orderId="o-1" order={ORDER} layout="dialog" onCancel={() => {}} onPaid={onPaid} />
    </QueryClientProvider>,
  )
  const register = await screen.findByRole("button", { name: /Registrar/ })
  await waitFor(() => expect(register).toBeEnabled())
  fireEvent.click(register)
  await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
  return onPaid.mock.calls[0]![0]
}

beforeEach(() => {
  payments.listPaymentMethods.mockReset().mockResolvedValue([CASH])
  payments.payOrder.mockReset()
  toasts.warning.mockReset()
  toasts.success.mockReset()
  useCashRegisterStore.setState({
    currentRegister: { id: "r-1", status: "open" } as unknown as CashRegister,
    isRegisterOpen: () => true,
  })
})

describe("PaymentPanel — invoice number and DIAN data (H-014 / S2)", () => {
  it("prints the number the server assigned and the DIAN lines of its snapshot", async () => {
    payments.payOrder.mockResolvedValue(paid({ invoiceNumber: "POS-000123", invoiceFiscal: FISCAL, invoiceWarnings: [] }))
    const invoice = await payOnce()
    expect(invoice.invoiceNumber).toBe("POS-000123")
    expect(invoice.fiscalLines).toEqual([
      "RESPONSABLE DE IVA",
      "RES. DIAN No. 18764000001234",
      "DEL 01/01/2026 AL 31/12/2027",
      "NUMERACIÓN POS-1 AL POS-5000",
    ])
    expect(toasts.warning).not.toHaveBeenCalled()
  })

  it("warns about the range and the resolution without stopping the payment", async () => {
    payments.payOrder.mockResolvedValue(
      paid({ invoiceNumber: "POS-005001", invoiceFiscal: FISCAL, invoiceWarnings: ["range_exceeded", "resolution_expired"] }),
    )
    const invoice = await payOnce()
    expect(invoice.invoiceNumber).toBe("POS-005001")
    expect(toasts.success).toHaveBeenCalledWith("Pago registrado correctamente")
    expect(toasts.warning.mock.calls.map((call) => call[0])).toEqual([
      "La factura POS-005001 supera el rango autorizado por la DIAN (hasta POS-5000). Actualiza la resolución en Ajustes.",
      "La resolución DIAN venció el 31/12/2027. Actualízala en Ajustes.",
    ])
  })

  it("keeps the old label and prints no DIAN text for a payment made before numbering (replayed)", async () => {
    payments.payOrder.mockResolvedValue(paid({ status: "already_paid", alreadyPaid: true, invoiceNumber: null, invoiceFiscal: null, invoiceWarnings: [] }))
    const invoice = await payOnce()
    expect(invoice.invoiceNumber).toBe("INV-o-1")
    expect(invoice.fiscalLines).toEqual([])
  })
})
