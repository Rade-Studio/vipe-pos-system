import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * caja-cierres S4: "Informe X" from the cashier header while the register is
 * open. informe-x-termico S1: with thermal printers (the invoice's
 * printingEnabled) it goes to them; S2: without them, or on "Ver en
 * pantalla", it opens on screen and the browser prints only on "Imprimir".
 */

vi.mock("@/components/cashier/OpenRegisterDialog", () => ({ OpenRegisterDialog: () => null }))
vi.mock("@/components/cashier/CloseRegisterDialog", () => ({ CloseRegisterDialog: () => null }))
vi.mock("@/components/cashier/AddCashDialog", () => ({ AddCashDialog: () => null }))
vi.mock("@/components/cashier/WithdrawCashDialog", () => ({ WithdrawCashDialog: () => null }))
vi.mock("@/lib/api/registers", () => ({}))
vi.mock("@/lib/api/payments", () => ({}))
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn() } }))
const print = vi.hoisted(() => ({ sendXReport: vi.fn(), xReportFailure: vi.fn(() => "No se pudo enviar el Informe X a la impresora.") }))
vi.mock("@/lib/api/print", () => print)
const notify = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast: notify }))

const summary = {
  registersCount: 1,
  initialCash: 200000,
  paymentsCount: 39,
  totalBilled: 0,
  totalTips: 118700,
  totalSales: 1486200,
  totalChange: 0,
  methods: [],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 789000,
  tipsPayout: 0,
  expectedCashAfterTips: 789000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: summary, isLoading: false }) }))

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CONFIG_QUERY_KEY } from "@/lib/api/config"
import { CashRegisterStatus } from "./CashRegisterStatus"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useConfigStore } from "@/store/use-config-store"

const register = {
  id: "r-1",
  openingTimestamp: new Date(2026, 10, 10, 7, 58),
  initialCash: 200000,
  status: "open" as const,
  transactions: [],
  cashTransactions: [],
  openedBy: { id: "p-1", name: "Camilo Henao" },
}

beforeEach(() => {
  useConfigStore.setState({ businessName: "La Fonda de Mariana", businessNIT: "901.234.567-8", businessAddress: "Medellín" })
})
afterEach(() => vi.restoreAllMocks())

const withConfig = (config: Record<string, unknown>) => {
  const client = new QueryClient()
  client.setQueryData(CONFIG_QUERY_KEY, config)
  return client
}
const spyOpen = () => {
  const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
  const open = vi.spyOn(window, "open").mockReturnValue({ document: doc } as unknown as Window)
  return { doc, open }
}

beforeEach(() => {
  print.sendXReport.mockReset().mockResolvedValue(undefined)
  notify.mockReset()
})

describe("CashRegisterStatus Informe X", () => {
  it("S1: with thermal printers it sends the summary as the server answered it and confirms, without the browser dialog", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    useConfigStore.setState({ taxPercentage: 8 })
    const { open } = spyOpen()
    render(<QueryClientProvider client={withConfig({ printingEnabled: true })}><CashRegisterStatus /></QueryClientProvider>)
    const button = screen.getByRole("button", { name: "Informe X" })
    expect(button).toHaveClass("h-11")
    fireEvent.click(button)
    await waitFor(() => expect(notify).toHaveBeenCalledWith({ title: "Informe X enviado a la impresora" }))
    expect(print.sendXReport).toHaveBeenCalledTimes(1)
    const job = print.sendXReport.mock.calls[0][0]
    expect(job.summary).toBe(summary)
    expect(job).toMatchObject({
      business: { name: "La Fonda de Mariana", nit: "901.234.567-8", address: "Medellín" },
      cashierName: "Camilo Henao",
      openedAt: register.openingTimestamp,
      tax: { type: "INC", rate: 8 },
    })
    expect(job.printedAt).toBeInstanceOf(Date)
    expect(open).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("S1: a failed send shows the reason and a Ver en pantalla action that opens it on screen", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    print.sendXReport.mockRejectedValue(new TypeError("Failed to fetch"))
    const { open } = spyOpen()
    render(<CashRegisterStatus />)
    fireEvent.click(screen.getByRole("button", { name: "Informe X" }))
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1))
    const shown = notify.mock.calls[0][0] as { title: string; description: string; variant: string; action: ReactElement }
    expect(shown).toMatchObject({ title: "Error", description: "No se pudo enviar el Informe X a la impresora.", variant: "destructive" })
    expect(print.xReportFailure).toHaveBeenCalledWith(expect.any(TypeError))
    expect(screen.queryByRole("dialog")).toBeNull()
    render(shown.action)
    fireEvent.click(screen.getByRole("button", { name: "Ver en pantalla" }))
    const dialog = await screen.findByRole("dialog", { name: "Informe X · parcial" })
    expect(dialog).toHaveTextContent(/Esperado ahora\s*\$ 789\.000/)
    expect(open).not.toHaveBeenCalled()
  })

  it("S2: with printers it also offers Ver en pantalla, which sends nothing", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    const { open } = spyOpen()
    render(<CashRegisterStatus />)
    fireEvent.click(screen.getByRole("button", { name: "Ver Informe X en pantalla" }))
    expect(await screen.findByRole("dialog", { name: "Informe X · parcial" })).toBeInTheDocument()
    expect(print.sendXReport).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it("S2: without thermal printers it opens on screen; the browser prints only on Imprimir, with the configured tax", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    useConfigStore.setState({ taxPercentage: 19 })
    const { doc, open } = spyOpen()
    render(<QueryClientProvider client={withConfig({ printingEnabled: false, taxType: "IVA" })}><CashRegisterStatus /></QueryClientProvider>)
    expect(screen.queryByRole("button", { name: "Ver Informe X en pantalla" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Informe X" }))
    const dialog = await screen.findByRole("dialog", { name: "Informe X · parcial" })
    expect(print.sendXReport).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent("Camilo Henao")
    expect(dialog).toHaveTextContent("IVA (19 %)")
    fireEvent.click(within(dialog).getByRole("button", { name: "Imprimir" }))
    expect(open).toHaveBeenCalledTimes(1)
    const html = doc.write.mock.calls[0][0] as string
    expect(html).toContain("INFORME X")
    expect(html).toContain("LA FONDA DE MARIANA")
    expect(html).toMatch(/Esperado ahora\s+\$ 789\.000/)
    expect(html).toContain("IVA (19 %)")
    expect(html).not.toContain("INC (")
  })

  it("keeps its other actions and has no Informe X while the register is closed", () => {
    useCashRegisterStore.setState({ currentRegister: null, registers: [] })
    render(<CashRegisterStatus />)
    expect(screen.queryByRole("button", { name: "Informe X" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Ver Informe X en pantalla" })).toBeNull()
    expect(screen.getByRole("button", { name: "Abrir caja" })).toBeInTheDocument()
  })
})
