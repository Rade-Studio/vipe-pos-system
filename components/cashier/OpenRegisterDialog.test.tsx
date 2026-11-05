import { fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T9 (S4) — the one-open-register rule lives on the server: the dialog shows
 * the API's 409 message instead of a client-side guard's silent `false`.
 */

const registers = vi.hoisted(() => ({ openRegister: vi.fn() }))
vi.mock("@/lib/api/registers", () => registers)
vi.mock("@/lib/api/payments", () => ({ closeRegisterRpc: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/utils/toast", () => ({ toast }))

import { OpenRegisterDialog } from "./OpenRegisterDialog"
import { PaymentServiceError } from "@/lib/payments/types"
import { useCashRegisterStore } from "@/store/use-cash-register-store"

beforeEach(() => {
  registers.openRegister.mockReset()
  toast.error.mockReset()
  toast.success.mockReset()
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

describe("OpenRegisterDialog", () => {
  it("shows the API 409 message", async () => {
    registers.openRegister.mockRejectedValue(
      new PaymentServiceError({ kind: "rejected", message: "A register is already open" }),
    )
    render(<OpenRegisterDialog open onOpenChange={() => {}} />)

    fireEvent.submit(document.querySelector("form")!)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A register is already open"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("keeps the generic message for other failures (PRESERVE)", async () => {
    registers.openRegister.mockRejectedValue(new PaymentServiceError({ kind: "unknown", message: "boom" }))
    render(<OpenRegisterDialog open onOpenChange={() => {}} />)

    fireEvent.submit(document.querySelector("form")!)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ocurrió un error al abrir la caja"))
  })

  it("opens and toasts success (PRESERVE)", async () => {
    registers.openRegister.mockResolvedValue({
      id: "r-1",
      openingTimestamp: new Date(),
      initialCash: 0,
      status: "open",
      transactions: [],
      cashTransactions: [],
    })
    const onOpenChange = vi.fn()
    render(<OpenRegisterDialog open onOpenChange={onOpenChange} />)

    fireEvent.submit(document.querySelector("form")!)

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(registers.openRegister).toHaveBeenCalledWith(0)
  })
})
