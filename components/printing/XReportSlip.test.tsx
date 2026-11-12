import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { XReportSlip, xReportLines } from "./XReportSlip"
import type { SlipTax } from "./tax-label"
import fixture from "@/lib/print/x-report-fixture.json"
import type { RegisterSummary } from "@/lib/payments/register-summary"

/** caja-cierres S4: "Informe X", a partial summary of the open shift. */
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
const business = { name: "La Fonda de Mariana", nit: "901.234.567-8", address: "Cra. 70 # 44-21" }

describe("XReportSlip", () => {
  it("prints the partial summary without resetting anything", () => {
    render(
      <XReportSlip
        business={business}
        cashierName="Camilo Henao"
        openedAt={new Date(2026, 10, 10, 7, 58)}
        printedAt={new Date(2026, 10, 10, 13, 30)}
        summary={slipSummary}
      />,
    )
    const slip = screen.getByRole("document", { name: "Informe X" })
    expect(slip).toHaveTextContent("LA FONDA DE MARIANA")
    expect(slip).toHaveTextContent("NIT 901.234.567-8")
    expect(slip).toHaveTextContent("Cra. 70 # 44-21")
    expect(slip).toHaveTextContent("INFORME X")
    expect(slip).toHaveTextContent(/No reinicia contadores/i)
    expect(slip).toHaveTextContent(/Cajero\s+Camilo Henao/)
    expect(slip).toHaveTextContent(/Abierto\s+10\/11\/2026 7:58 a\.m\./)
    expect(slip).toHaveTextContent(/Impreso\s+10\/11\/2026 1:30 p\.m\./)
    expect(slip).toHaveTextContent(/Efectivo \(15\)\s+\$ 584\.000/)
    expect(slip).toHaveTextContent(/Nequi \(6\)\s+\$ 184\.000/)
    expect(slip).toHaveTextContent(/Tiquetes\s+39/)
    expect(slip).toHaveTextContent(/Fondo de caja\s+\$ 200\.000/)
    expect(slip).toHaveTextContent(/\+ Entradas\s+\$ 50\.000/)
    expect(slip).toHaveTextContent(/− Salidas\s+\$ 45\.000/)
    expect(slip).toHaveTextContent(/Esperado ahora\s+\$ 789\.000/)
    expect(slip).toHaveTextContent(/Propinas \(aparte\)\s+\$ 118\.700/)
    expect(slip).toHaveTextContent("No son ingreso del restaurante")
  })

  it("fits 58 mm paper (32 characters a line)", () => {
    render(
      <XReportSlip business={business} cashierName={null} openedAt={new Date()} printedAt={new Date()} summary={slipSummary} paperMm={58} />,
    )
    const lines = screen.getByRole("document", { name: "Informe X" }).querySelectorAll("[data-line]")
    for (const line of lines) expect((line.textContent ?? "").length).toBeLessThanOrEqual(32)
  })

  it("prints the base and the tax with the configured label, never a hard-coded IVA", () => {
    const props = { business, cashierName: null, openedAt: new Date(), printedAt: new Date(), summary: slipSummary }
    const { unmount } = render(<XReportSlip {...props} tax={{ type: "INC", rate: 8 }} />)
    const slip = screen.getByRole("document", { name: "Informe X" })
    expect(slip).toHaveTextContent(/Base\s+\$ 1\.376\.111/)
    expect(slip).toHaveTextContent(/INC \(8 %\)\s+\$ 110\.089/)
    expect(slip).not.toHaveTextContent("IVA")
    unmount()
    render(<XReportSlip {...props} tax={{ type: "IVA", rate: 19 }} />)
    expect(screen.getByRole("document", { name: "Informe X" })).toHaveTextContent(/IVA \(19 %\)\s+\$ 237\.292/)
  })

  it("prints no tax line when the tax setting is not given", () => {
    render(<XReportSlip business={business} cashierName={null} openedAt={new Date()} printedAt={new Date()} summary={slipSummary} />)
    const slip = screen.getByRole("document", { name: "Informe X" })
    expect(slip).not.toHaveTextContent(/IVA|INC|Base/)
  })
})

/**
 * informe-x-termico S1: the thermal printers (desktop/core escpos/x_report.rs,
 * pos/print_renderer.py) print these same lines from the x_report payload.
 */
describe("x_report fixture shared with the thermal renderers", () => {
  const wallTime = (iso: string) => {
    const [y, m, d, h, min] = iso.split(/[-T:]/).map(Number)
    return new Date(y, m - 1, d, h, min)
  }
  const { payload } = fixture
  for (const paperMm of [80, 58] as const) {
    it(`renders the fixture lines at ${paperMm} mm`, () => {
      const lines = xReportLines({
        business: payload.business,
        cashierName: payload.cashierName,
        openedAt: wallTime(payload.openedAt),
        printedAt: wallTime(payload.printedAt),
        summary: payload.summary as RegisterSummary,
        tax: payload.tax as SlipTax,
        paperMm,
      })
      expect(lines.map((line) => ({ text: line.text, bold: line.bold ?? false }))).toEqual(fixture.lines[String(paperMm) as "80" | "58"])
    })
  }
})
