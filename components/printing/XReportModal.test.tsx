import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { XReportModal, type XReportData } from "./XReportModal"
import type { RegisterSummary } from "@/lib/payments/register-summary"

/** informe-x-termico S2: "Informe X" on screen, with the slip's data and a browser print only on request. */
const method = (name: string, kind: "cash" | "electronic", total: number, tendersCount: number, isActive = true) => ({
  paymentMethodId: name, code: name, name, kind, sortOrder: 0, isActive, total, tendersCount,
})
const summary: RegisterSummary = {
  registersCount: 1,
  initialCash: 200000,
  paymentsCount: 39,
  totalBilled: 1604900,
  totalTips: 118700,
  totalSales: 1486200,
  totalChange: 2000,
  methods: [method("Efectivo", "cash", 584000, 15), method("Nequi", "electronic", 184000, 6), method("Bono", "electronic", 0, 0, false)],
  cashDeposits: 50000,
  cashWithdrawals: 45000,
  expectedCash: 787000,
  tipsPayout: 0,
  expectedCashAfterTips: 787000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
const report: XReportData = {
  business: { name: "La Fonda de Mariana", nit: "901.234.567-8", address: "Cra. 70 # 44-21" },
  cashierName: "Camilo Henao",
  openedAt: new Date(2026, 10, 10, 7, 58),
  printedAt: new Date(2026, 10, 10, 13, 30),
  summary,
  tax: { type: "INC", rate: 8 },
}

afterEach(() => vi.restoreAllMocks())

const section = (dialog: HTMLElement, name: string) => within(dialog).getByRole("region", { name })

describe("XReportModal", () => {
  it("shows the shift, sales, cash and tips in headed sections with the totals emphasised", () => {
    render(<XReportModal open onOpenChange={vi.fn()} report={report} />)
    const dialog = screen.getByRole("dialog", { name: "Informe X · parcial" })
    expect(dialog).toHaveTextContent("La Fonda de Mariana · NIT 901.234.567-8 · No reinicia contadores")

    const shift = section(dialog, "Turno")
    expect(shift).toHaveTextContent(/Cajero\s*Camilo Henao/)
    expect(shift).toHaveTextContent(/Abierto\s*10\/11\/2026 7:58 a\.m\./)
    expect(shift).toHaveTextContent(/Impreso\s*10\/11\/2026 1:30 p\.m\./)

    const sales = section(dialog, "Ventas por método")
    expect(sales).toHaveTextContent(/Efectivo \(15\)\s*\$ 584\.000/)
    expect(sales).toHaveTextContent(/Nequi \(6\)\s*\$ 184\.000/)
    expect(sales).not.toHaveTextContent("Bono")
    expect(sales).toHaveTextContent(/Base\s*\$ 1\.376\.111/)
    expect(sales).toHaveTextContent(/INC \(8 %\)\s*\$ 110\.089/)
    expect(sales).toHaveTextContent(/Tiquetes\s*39/)
    expect(within(sales).getByText("$ 1.486.200").parentElement).toHaveClass("font-semibold")

    const cash = section(dialog, "Efectivo en caja")
    expect(cash).toHaveTextContent(/Fondo de caja\s*\$ 200\.000/)
    expect(cash).toHaveTextContent(/\+ Ventas en efectivo\s*\$ 584\.000/)
    expect(cash).toHaveTextContent(/− Cambio entregado\s*\$ 2\.000/)
    expect(cash).toHaveTextContent(/\+ Entradas\s*\$ 50\.000/)
    expect(cash).toHaveTextContent(/− Salidas\s*\$ 45\.000/)
    expect(within(cash).getByText("$ 787.000").parentElement).toHaveClass("font-semibold")

    const tips = section(dialog, "Propinas")
    expect(tips).toHaveTextContent(/Propinas \(aparte\)\s*\$ 118\.700/)
    expect(tips).toHaveTextContent("No son ingreso del restaurante.")
    expect(dialog).toHaveTextContent("Este informe no cierra el turno.")
  })

  it("prints no tax lines without a tax setting and a dash without a cashier", () => {
    render(<XReportModal open onOpenChange={vi.fn()} report={{ ...report, tax: undefined, cashierName: null }} />)
    const dialog = screen.getByRole("dialog", { name: "Informe X · parcial" })
    expect(section(dialog, "Ventas por método")).not.toHaveTextContent(/Base|INC/)
    expect(section(dialog, "Turno")).toHaveTextContent(/Cajero\s*—/)
  })

  it("opens no browser print by itself; Imprimir prints the current slip", () => {
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
    const open = vi.spyOn(window, "open").mockReturnValue({ document: doc } as unknown as Window)
    render(<XReportModal open onOpenChange={vi.fn()} report={report} />)
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }))
    expect(open).toHaveBeenCalledTimes(1)
    const html = doc.write.mock.calls[0][0] as string
    expect(html).toContain("<title>Informe X</title>")
    expect(html).toContain("INFORME X")
    expect(html).toMatch(/Esperado ahora\s+\$ 787\.000/)
  })

  it("tells the caller when the browser blocks the print window", () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    const onPrintBlocked = vi.fn()
    render(<XReportModal open onOpenChange={vi.fn()} report={report} onPrintBlocked={onPrintBlocked} />)
    fireEvent.click(screen.getByRole("button", { name: "Imprimir" }))
    expect(onPrintBlocked).toHaveBeenCalledTimes(1)
  })

  it("is an accessible dialog: focus moves inside, Cerrar and Escape close it", () => {
    const onOpenChange = vi.fn()
    render(<XReportModal open onOpenChange={onOpenChange} report={report} />)
    const dialog = screen.getByRole("dialog", { name: "Informe X · parcial" })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Cerrar" }).find((b) => b.textContent === "Cerrar")!)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    onOpenChange.mockClear()
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("renders nothing without a report", () => {
    render(<XReportModal open onOpenChange={vi.fn()} report={null} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
