import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** caja-cierres S2: every cash entry carries a reason; Otro requires a description. */

const registers = vi.hoisted(() => ({ addCashTransaction: vi.fn() }))
vi.mock("@/lib/api/registers", async (importActual) => ({
  CASH_MOVEMENT_REASONS: (await importActual<typeof import("@/lib/api/registers")>()).CASH_MOVEMENT_REASONS,
  ...registers,
}))
vi.mock("@/lib/api/payments", () => ({ closeRegisterRpc: vi.fn() }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: { expectedCash: 100000 } }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))

import { AddCashDialog } from "./AddCashDialog"
import { useCashRegisterStore } from "@/store/use-cash-register-store"

const register = { id: "r-1", openingTimestamp: new Date(), initialCash: 0, status: "open" as const, transactions: [], cashTransactions: [] }
const movement = { id: "c-1", amount: 5000, type: "deposit", description: "", timestamp: new Date(), cash_register_id: "r-1" }

beforeEach(() => {
  registers.addCashTransaction.mockReset().mockResolvedValue(movement)
  toast.error.mockReset()
  useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
})

const typeAmount = () => {
  fireEvent.click(screen.getByRole("button", { name: "5" }))
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "0" }))
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Agregar Efectivo" }))

describe("AddCashDialog reason", () => {
  it("offers the six reasons", () => {
    render(<AddCashDialog open onOpenChange={() => {}} />)
    const select = screen.getByLabelText("Motivo")
    expect(within(select).getAllByRole("option").slice(1).map((o) => o.textContent)).toEqual([
      "Sencillo / base",
      "Pago a proveedor",
      "Caja menor",
      "Propinas pagadas",
      "Caja fuerte / consignación",
      "Otro",
    ])
  })

  it("requires a reason before sending", async () => {
    render(<AddCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    submit()
    expect(await screen.findByText("Selecciona el motivo del ingreso")).toBeInTheDocument()
    expect(registers.addCashTransaction).not.toHaveBeenCalled()
  })

  it("sends the deposit with the reason", async () => {
    render(<AddCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "change_fund" } })
    submit()
    await waitFor(() => expect(registers.addCashTransaction).toHaveBeenCalledWith("r-1", 5000, "deposit", "change_fund", ""))
  })

  it("requires a description for Otro", async () => {
    render(<AddCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "other" } })
    submit()
    expect(await screen.findByText("Describe el motivo")).toBeInTheDocument()
    expect(registers.addCashTransaction).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "  Vuelto del banco " } })
    submit()
    await waitFor(() => expect(registers.addCashTransaction).toHaveBeenCalledWith("r-1", 5000, "deposit", "other", "Vuelto del banco"))
  })
})
