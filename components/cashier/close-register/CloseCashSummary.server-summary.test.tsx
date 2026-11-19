import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { CloseCashSummary } from "./CloseCashSummary"
import { pesos } from "@/components/printing/slip-format"

// The server's register_summary of the payments API spec "close summary arithmetic (H-063)" (cash with change and tip, deposit, withdrawal,
// two cash-kind methods, one inactive), verbatim.
const m = (name: string, kind: "cash" | "electronic", total: number, isActive = true, id = name) => ({
  paymentMethodId: id, code: id, name, kind, sortOrder: 0, isActive, total, tendersCount: total ? 1 : 0,
})
const server: RegisterSummary = {
  registersCount: 1, initialCash: 50000, paymentsCount: 7, totalBilled: 43000, totalTips: 1500, totalSales: 44500, totalChange: 48500,
  methods: [m("Tarjeta débito", "cash", 0, true, "td2"), m("Tarjeta Débito", "electronic", 0), m("Retirado", "electronic", 0, false),
    m("Nequi", "electronic", 3000), m("Efectivo", "cash", 41500)],
  cashDeposits: 20000, cashWithdrawals: 7000, expectedCash: 104500, tipsPayout: 1500, expectedCashAfterTips: 103000,
  legacy: { paymentsCount: 1, total: 7000, tips: 0, change: 0, byMethod: { nequi: 7000 } },
}
const value = (label: string) => screen.getByText(label).parentElement!.textContent!.replace(label, "")

describe("CloseCashSummary with a server register_summary (H-063)", () => {
  it("each list adds up and matches the server fields", () => {
    render(<CloseCashSummary summary={server} />)
    expect(value("Efectivo inicial")).toBe(pesos(50000))
    expect(value("+ Ventas en efectivo")).toBe(pesos(41500))
    expect(value("+ Ingresos de efectivo")).toBe(pesos(20000))
    expect(value("− Retiros de efectivo")).toBe(pesos(7000))
    expect(value("= Efectivo esperado")).toBe(pesos(50000 + 41500 + 20000 - 7000))
    expect(value("− Propinas a entregar a meseros")).toBe(pesos(1500))
    expect(value("= Efectivo esperado después de propinas")).toBe(pesos(104500 - 1500))
    expect(value("Total electrónico")).toBe(pesos(3000))
    expect(value("Ventas sin propina")).toBe(pesos(43000))
    expect(value("+ Propinas")).toBe(pesos(1500))
    expect(value("= Total cobrado")).toBe(pesos(43000 + 1500))
    expect(screen.getByText(`Efectivo ${pesos(41500)} + electrónicos ${pesos(3000)} = ${pesos(44500)}`)).toBeInTheDocument()
    expect(screen.getByText(`Las ventas en efectivo ya descuentan ${pesos(48500)} de cambio entregado.`)).toBeInTheDocument()
    expect(screen.queryByText("Retirado")).toBeNull()
    // No "Ventas" line of every method inside the cash list (H-063 triage) and no negative amounts.
    expect(document.body.textContent).not.toMatch(/-\s?\$/)
  })
})
