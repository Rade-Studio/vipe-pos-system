import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** caja-cierres S2: every withdrawal carries a reason; Otro requires a description. */

const registers = vi.hoisted(() => ({ addCashTransaction: vi.fn() }))
vi.mock("@/lib/api/registers", async (importActual) => ({
  CASH_MOVEMENT_REASONS: (await importActual<typeof import("@/lib/api/registers")>()).CASH_MOVEMENT_REASONS,
  ...registers,
}))
vi.mock("@/lib/api/payments", () => ({ closeRegisterRpc: vi.fn() }))
vi.mock("@/hooks/use-register-summary", () => ({ useRegisterSummary: () => ({ data: { expectedCash: 100000 } }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))

import { WithdrawCashDialog } from "./WithdrawCashDialog"
import { useCashRegisterStore } from "@/store/use-cash-register-store"

const register = { id: "r-1", openingTimestamp: new Date(), initialCash: 0, status: "open" as const, transactions: [], cashTransactions: [] }
const movement = { id: "c-1", amount: 5000, type: "withdrawal", description: "", timestamp: new Date(), cash_register_id: "r-1" }

beforeEach(() => {
  registers.addCashTransaction.mockReset().mockResolvedValue(movement)
  useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
})

const typeAmount = () => {
  fireEvent.click(screen.getByRole("button", { name: "5" }))
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "0" }))
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Retirar Efectivo" }))

describe("WithdrawCashDialog reason", () => {
  it("offers the six reasons", () => {
    render(<WithdrawCashDialog open onOpenChange={() => {}} />)
    expect(within(screen.getByLabelText("Motivo")).getAllByRole("option").slice(1).map((o) => o.textContent)).toEqual([
      "Sencillo / base",
      "Pago a proveedor",
      "Caja menor",
      "Propinas pagadas",
      "Caja fuerte / consignación",
      "Otro",
    ])
  })

  it("requires a reason before sending", async () => {
    render(<WithdrawCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    submit()
    expect(await screen.findByText("Selecciona el motivo del retiro")).toBeInTheDocument()
    expect(registers.addCashTransaction).not.toHaveBeenCalled()
  })

  it("sends the withdrawal with the reason; the description is optional", async () => {
    render(<WithdrawCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "supplier" } })
    submit()
    await waitFor(() => expect(registers.addCashTransaction).toHaveBeenCalledWith("r-1", 5000, "withdrawal", "supplier", ""))
  })

  it("requires a description for Otro", async () => {
    render(<WithdrawCashDialog open onOpenChange={() => {}} />)
    typeAmount()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "other" } })
    submit()
    expect(await screen.findByText("Describe el motivo")).toBeInTheDocument()
    expect(registers.addCashTransaction).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "Hielo" } })
    submit()
    await waitFor(() => expect(registers.addCashTransaction).toHaveBeenCalledWith("r-1", 5000, "withdrawal", "other", "Hielo"))
  })

  it("still refuses more than the cash in the drawer (PRESERVE)", async () => {
    render(<WithdrawCashDialog open onOpenChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "0" }))
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "supplier" } })
    submit()
    expect(await screen.findByText(/No hay suficiente efectivo en caja/)).toBeInTheDocument()
    expect(registers.addCashTransaction).not.toHaveBeenCalled()
  })
})
