import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ShiftCloseSlip, shiftCloseLines } from "./ShiftCloseSlip"
import type { RegisterSummary } from "@/lib/payments/register-summary"

/** caja-cierres S4: "Cierre de turno" with the arqueo and signature lines. */
const method = (name: string, kind: "cash" | "electronic", total: number, tendersCount: number) => ({
  paymentMethodId: name, code: name, name, kind, sortOrder: 0, isActive: true, total, tendersCount,
})
const slipSummary: RegisterSummary = {
  registersCount: 1,
  initialCash: 200000,
  paymentsCount: 39,
  totalBilled: 1604900,
  totalTips: 118700,
  totalSales: 1486200,
  totalChange: 0,
  methods: [method("Efectivo", "cash", 584000, 15), method("Nequi", "electronic", 184000, 6)],
  cashDeposits: 50000,
  cashWithdrawals: 45000,
  expectedCash: 789000,
  tipsPayout: 0,
  expectedCashAfterTips: 789000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
const business = { name: "La Fonda de Mariana", nit: "901.234.567-8", address: "Medellín" }
const movements = [
  { id: "m1", amount: 50000, type: "deposit" as const, description: "", timestamp: new Date(), cash_register_id: "r", reason: "change_fund" as const, createdBy: null },
  { id: "m2", amount: 45000, type: "withdrawal" as const, description: "Hielo", timestamp: new Date(), cash_register_id: "r", reason: "supplier" as const, createdBy: null },
]
const base = {
  business,
  cashierName: "Camilo Henao",
  openedAt: new Date(2026, 10, 10, 7, 58),
  summary: { ...slipSummary, tipsPayout: 74000, expectedCashAfterTips: 715000 },
  movements,
}

describe("ShiftCloseSlip", () => {
  it("prints the closed shift with the arqueo, the difference, the note and the signatures", () => {
    render(
      <ShiftCloseSlip
        {...base}
        closedAt={new Date(2026, 10, 10, 15, 12)}
        closedByName="Camilo Henao"
        countedCash={711500}
        difference={-3500}
        note="Cambio mal dado en mesa 7"
        denominations={[{ value: 100000, quantity: 7 }, { value: 500, quantity: 23 }]}
      />,
    )
    const slip = screen.getByRole("document", { name: "Cierre de turno" })
    expect(slip).toHaveTextContent("LA FONDA DE MARIANA")
    expect(slip).toHaveTextContent("CIERRE DE TURNO")
    expect(slip).not.toHaveTextContent("VISTA PREVIA")
    expect(slip).toHaveTextContent(/Apertura\s+10\/11\/2026 7:58 a\.m\./)
    expect(slip).toHaveTextContent(/Cierre\s+10\/11\/2026 3:12 p\.m\./)
    expect(slip).toHaveTextContent(/Cerró\s+Camilo Henao/)
    expect(slip).toHaveTextContent(/Fondo de caja\s+\$ 200\.000/)
    expect(slip).toHaveTextContent(/\+ Ventas en efectivo\s+\$ 584\.000/)
    expect(slip).toHaveTextContent(/Nequi \(6\)\s+\$ 184\.000/)
    expect(slip).toHaveTextContent(/\+ Entradas\s+\$ 50\.000/)
    expect(slip).toHaveTextContent(/Sencillo \/ base\s+\$ 50\.000/)
    expect(slip).toHaveTextContent(/− Salidas\s+\$ 45\.000/)
    expect(slip).toHaveTextContent(/Pago a proveedor\s+\$ 45\.000/)
    expect(slip).toHaveTextContent(/− Propinas pagadas\s+\$ 74\.000/)
    expect(slip).toHaveTextContent(/Esperado\s+\$ 715\.000/)
    expect(slip).toHaveTextContent(/\$ 100\.000 × 7\s+\$ 700\.000/)
    expect(slip).toHaveTextContent(/\$ 500 × 23\s+\$ 11\.500/)
    expect(slip).toHaveTextContent(/Contado\s+\$ 711\.500/)
    expect(slip).toHaveTextContent(/FALTANTE\s+−\$ 3\.500/)
    expect(slip).toHaveTextContent("Nota: Cambio mal dado en mesa 7")
    expect(slip).toHaveTextContent("Cajero")
    expect(slip).toHaveTextContent("Supervisor")
  })

  it("marks a preview and leaves out the arqueo table without denominations", () => {
    render(<ShiftCloseSlip {...base} preview closedAt={null} closedByName={null} countedCash={715000} difference={0} note={null} denominations={null} />)
    const slip = screen.getByRole("document", { name: "Cierre de turno" })
    expect(slip).toHaveTextContent("VISTA PREVIA")
    expect(slip).toHaveTextContent(/CUADRA/)
    expect(slip).not.toHaveTextContent("×")
    expect(slip).not.toHaveTextContent("Nota:")
  })

  it("prints the base and the tax of the shift's sales with the configured label", () => {
    render(
      <ShiftCloseSlip {...base} tax={{ type: "INC", rate: 8 }} closedAt={null} closedByName={null} countedCash={715000} difference={0} note={null} denominations={null} />,
    )
    const slip = screen.getByRole("document", { name: "Cierre de turno" })
    expect(slip).toHaveTextContent(/Base\s+\$ 1\.376\.111/)
    expect(slip).toHaveTextContent(/INC \(8 %\)\s+\$ 110\.089/)
    expect(slip).not.toHaveTextContent("IVA")
  })
  it("prints the deliveries apart and, per courier, the cash they bring and the fees to pay (H-080)", () => {
    const delivery = {
      fees: 10000, ordersCount: 3, foodBilled: 1594900, cashCollected: 45000,
      couriers: [
        { courierId: "c-1", name: "Carlos", ordersCount: 2, cashCollected: 35000, feesOwed: 8000 },
        { courierId: null, name: null, ordersCount: 1, cashCollected: 10000, feesOwed: 2000 },
      ],
    }
    const props = { ...base, summary: { ...base.summary, delivery }, closedAt: null, closedByName: null, countedCash: 0, difference: 0, note: null, denominations: null }
    const text = shiftCloseLines(props).map((line) => line.text)
    const at = (pattern: RegExp, from = 0) => text.findIndex((line, i) => i >= from && pattern.test(line))
    expect(text[at(/^Domicilios$/)]).toBe("Domicilios")
    expect(text[at(/^Ventas de comida/)]).toMatch(/\$ 1\.594\.900$/)
    expect(text[at(/^Tarifas de domicilio \(3\)/)]).toMatch(/\$ 10\.000$/)
    const carlos = at(/^Carlos \(2\)$/)
    expect(carlos).toBeGreaterThan(-1)
    expect(text[at(/^ {3}Efectivo que trae/, carlos)]).toMatch(/\$ 35\.000$/)
    expect(text[at(/^ {3}Tarifas a pagar/, carlos)]).toMatch(/\$ 8\.000$/)
    const nobody = at(/^Sin repartidor \(1\)$/)
    expect(text[at(/^ {3}Efectivo que trae/, nobody)]).toMatch(/\$ 10\.000$/)
    // The cash and sales lines stay as they were.
    expect(text[at(/^Ventas netas turno/)]).toMatch(/\$ 1\.486\.200$/)
    expect(text[at(/^Esperado/)]).toMatch(/\$ 715\.000$/)
    for (const line of text) expect(line.length).toBeLessThanOrEqual(48)
  })

  it("prints no delivery block for a summary without deliveries", () => {
    const props = { ...base, closedAt: null, closedByName: null, countedCash: 0, difference: 0, note: null, denominations: null }
    const text = shiftCloseLines(props).map((line) => line.text)
    expect(text.some((line) => /Ventas de comida|Efectivo que trae/.test(line))).toBe(false)
    const zero = shiftCloseLines({ ...props, summary: { ...props.summary, delivery: { fees: 0, ordersCount: 0, foodBilled: 0, cashCollected: 0, couriers: [] } } })
    expect(zero.map((line) => line.text)).toEqual(text)
  })
})
