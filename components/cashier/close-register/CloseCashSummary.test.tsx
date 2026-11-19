import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { RegisterSummary } from "@/lib/payments/register-summary"
import { CloseCashSummary } from "./CloseCashSummary"

/** H-063: a close summary the cashier can add up line by line. */
const method = (id: string, name: string, kind: "cash" | "electronic", total: number, isActive = true) => ({
  paymentMethodId: id,
  code: id,
  name,
  kind,
  sortOrder: 0,
  isActive,
  total,
  tendersCount: total > 0 ? 1 : 0,
})
const summary: RegisterSummary = {
  registersCount: 1,
  initialCash: 100000,
  paymentsCount: 4,
  totalBilled: 91000,
  totalTips: 9000,
  totalSales: 100000,
  totalChange: 5000,
  methods: [
    method("cash", "Efectivo", "cash", 55000),
    method("nequi", "Nequi", "electronic", 40000),
    method("card", "Tarjeta", "electronic", 5000),
    method("davi", "Daviplata", "electronic", 0, false),
  ],
  cashDeposits: 20000,
  cashWithdrawals: 10000,
  expectedCash: 165000,
  tipsPayout: 9000,
  expectedCashAfterTips: 156000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}

const rows = (name: string) =>
  within(screen.getByRole("region", { name }))
    .getAllByRole("listitem")
    .map((row) => row.textContent)
const amount = (text: string | null) => Number((text ?? "").replace(/.*\$ /, "").replace(/\./g, ""))

describe("CloseCashSummary (H-063)", () => {
  it("lists the drawer cash so that it adds up to Efectivo esperado and then to the cash after tips", () => {
    render(<CloseCashSummary summary={summary} />)
    const cash = rows("Efectivo en caja")
    expect(cash).toEqual([
      "Efectivo inicial$ 100.000",
      "+ Ventas en efectivo$ 55.000",
      "+ Ingresos de efectivo$ 20.000",
      "− Retiros de efectivo$ 10.000",
      "= Efectivo esperado$ 165.000",
      "− Propinas a entregar a meseros$ 9.000",
      "= Efectivo esperado después de propinas$ 156.000",
    ])
    const [initial, sales, deposits, withdrawals, expected, tips, after] = cash.map(amount)
    expect(initial + sales + deposits - withdrawals).toBe(expected)
    expect(expected - tips).toBe(after)
    expect(screen.getByText("Las ventas en efectivo ya descuentan $ 5.000 de cambio entregado.")).toBeInTheDocument()
    expect(screen.queryByText(/-\$/)).toBeNull()
  })

  it("puts the electronic methods in their own block with their total; an unused inactive method is left out", () => {
    render(<CloseCashSummary summary={summary} />)
    expect(rows("Pagos electrónicos")).toEqual(["Nequi$ 40.000", "Tarjeta$ 5.000", "Total electrónico$ 45.000"])
    expect(screen.queryByText("Daviplata")).toBeNull()
  })

  it("shows one explained sales total: sales without tip plus tips is what was charged, split cash and electronic", () => {
    render(<CloseCashSummary summary={summary} />)
    expect(rows("Ventas del turno")).toEqual([
      "Ventas sin propina$ 91.000",
      "+ Propinas$ 9.000",
      "= Total cobrado$ 100.000",
      "Cuentas pagadas4",
    ])
    expect(screen.getByText("Efectivo $ 55.000 + electrónicos $ 45.000 = $ 100.000")).toBeInTheDocument()
    expect(screen.queryByText(/Total facturado/)).toBeNull()
  })

  it("leaves out the change note and the electronic block when there is nothing to show", () => {
    render(<CloseCashSummary summary={{ ...summary, totalChange: 0, methods: [method("cash", "Efectivo", "cash", 55000)] }} />)
    expect(screen.queryByText(/cambio entregado/)).toBeNull()
    expect(screen.queryByRole("region", { name: "Pagos electrónicos" })).toBeNull()
  })
})
