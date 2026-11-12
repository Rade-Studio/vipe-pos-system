import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** caja-cierres S4: "Informe X" prints from the cashier header while the register is open. */

vi.mock("@/components/cashier/OpenRegisterDialog", () => ({ OpenRegisterDialog: () => null }))
vi.mock("@/components/cashier/CloseRegisterDialog", () => ({ CloseRegisterDialog: () => null }))
vi.mock("@/components/cashier/AddCashDialog", () => ({ AddCashDialog: () => null }))
vi.mock("@/components/cashier/WithdrawCashDialog", () => ({ WithdrawCashDialog: () => null }))
vi.mock("@/lib/api/registers", () => ({}))
vi.mock("@/lib/api/payments", () => ({}))
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: vi.fn() } }))

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

describe("CashRegisterStatus Informe X", () => {
  it("prints the Informe X of the open register", () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() }
    vi.spyOn(window, "open").mockReturnValue({ document: doc } as unknown as Window)
    render(<CashRegisterStatus />)
    const button = screen.getByRole("button", { name: "Informe X" })
    expect(button).toHaveClass("h-11")
    fireEvent.click(button)
    const html = doc.write.mock.calls[0][0] as string
    expect(html).toContain("INFORME X")
    expect(html).toContain("LA FONDA DE MARIANA")
    expect(html).toContain("Camilo Henao")
    expect(html).toMatch(/Esperado ahora\s+\$ 789\.000/)
  })

  it("keeps its other actions and has no Informe X while the register is closed", () => {
    useCashRegisterStore.setState({ currentRegister: null, registers: [] })
    render(<CashRegisterStatus />)
    expect(screen.queryByRole("button", { name: "Informe X" })).toBeNull()
    expect(screen.getByRole("button", { name: "Abrir caja" })).toBeInTheDocument()
  })
})
