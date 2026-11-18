import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/** H-039: the register history reports errors through the one toast system (shadcn useToast). */

const shadcnToast = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast: shadcnToast, useToast: () => ({ toast: shadcnToast, toasts: [] }) }))
const sonner = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("sonner", () => sonner)

import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { RegisterHistoryTable } from "./RegisterHistoryTable"

describe("RegisterHistoryTable errors (H-039)", () => {
  it("shows the error in the shadcn toast, not Sonner", () => {
    const register = {
      id: "r-1",
      openingTimestamp: new Date("2026-11-10T08:00:00Z"),
      initialCash: 0,
      transactions: [],
      cashTransactions: [],
      status: "closed",
    }
    useCashRegisterStore.setState({ getAllRegisters: () => [register] } as never)
    const changeRegisterDetails = vi.fn(() => {
      throw new Error("boom")
    })
    render(<RegisterHistoryTable changeRegisterDetails={changeRegisterDetails} />)

    fireEvent.click(screen.getByRole("button", { name: /Ver Detalles/ }))

    expect(shadcnToast).toHaveBeenCalledWith({
      title: "Error",
      description: "Error al ver los detalles de la caja",
      variant: "destructive",
    })
    expect(sonner.toast.error).not.toHaveBeenCalled()
  })
})
