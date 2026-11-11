import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T5 (S1): `loadCurrentRegister` and `loadAllRegisters` used to flip a shared
 * `isLoading` flag. Every one of the twelve `useCashRegisterStore()` consumers
 * reads the store without a selector, so each flip re-rendered all of them, and
 * running both loads in parallel made the flag bounce true/false/true while
 * each load finished. No consumer reads that flag (grep: the cashier/admin/
 * delivery screens use their own local `isLoading` or a React Query one), so the
 * observable contract is the register data itself.
 */
const service = vi.hoisted(() => ({
  getCurrentRegister: vi.fn(),
  getOpenRegister: vi.fn(),
  getAllRegisters: vi.fn(),
  getTransactionsByRegisterId: vi.fn(),
  getCashTransactionsByRegisterId: vi.fn(),
  openRegister: vi.fn(),
  addCashTransaction: vi.fn(),
}))

vi.mock("@/lib/api/registers", () => service)

const payments = vi.hoisted(() => ({ closeRegisterRpc: vi.fn() }))
vi.mock("@/lib/api/payments", async (importActual) => ({
  openOrdersConflictOf: (await importActual<typeof import("@/lib/api/payments")>()).openOrdersConflictOf,
  ...payments,
}))

import { useCashRegisterStore } from "./use-cash-register-store"
import { PaymentServiceError } from "@/lib/payments/types"
import { ApiError } from "@/lib/api/errors"

const register = {
  id: "r-1",
  openingTimestamp: new Date("2026-01-01T00:00:00.000Z"),
  initialCash: 100,
  status: "open" as const,
  transactions: [],
  cashTransactions: [],
}

beforeEach(() => {
  service.getCurrentRegister.mockReset()
  service.getOpenRegister.mockReset()
  service.getAllRegisters.mockReset()
  useCashRegisterStore.setState({ currentRegister: null, registers: [] })
})

describe("loadCurrentRegister", () => {
  it("notifies subscribers once, with the register, and never flips a shared loading flag", async () => {
    service.getCurrentRegister.mockResolvedValue(register)

    const snapshots: Record<string, unknown>[] = []
    const unsubscribe = useCashRegisterStore.subscribe((state) => snapshots.push({ ...state }))
    await useCashRegisterStore.getState().loadCurrentRegister()
    unsubscribe()

    expect(snapshots).toHaveLength(1)
    expect(snapshots.every((s) => s.isLoading !== true)).toBe(true)
    expect(useCashRegisterStore.getState().currentRegister?.id).toBe("r-1")
  })

  it("keeps merging the open register into `registers` (PRESERVE)", async () => {
    service.getCurrentRegister.mockResolvedValue(register)

    await useCashRegisterStore.getState().loadCurrentRegister()

    expect(useCashRegisterStore.getState().registers.map((r) => r.id)).toEqual(["r-1"])
  })

  it("leaves the store untouched when the register service throws (PRESERVE)", async () => {
    service.getCurrentRegister.mockRejectedValue(new Error("network"))

    await expect(useCashRegisterStore.getState().loadCurrentRegister()).resolves.toBeUndefined()

    expect(useCashRegisterStore.getState().currentRegister).toBeNull()
    expect(useCashRegisterStore.getState().registers).toEqual([])
  })
})

describe("loadOpenRegister (T10: only open/closed matters)", () => {
  it("asks the service ONCE for the open register and never for the full load", async () => {
    service.getOpenRegister.mockResolvedValue(register)
    service.getCurrentRegister.mockResolvedValue(register)

    await useCashRegisterStore.getState().loadOpenRegister()

    expect(service.getOpenRegister).toHaveBeenCalledTimes(1)
    expect(service.getCurrentRegister).not.toHaveBeenCalled()
    expect(useCashRegisterStore.getState().currentRegister?.id).toBe("r-1")
    expect(useCashRegisterStore.getState().isRegisterOpen()).toBe(true)
    // The lightweight row carries no transaction history: that is the whole
    // point of the check (the full load reads payment_transactions +
    // cash_transactions on top of the register row).
    expect(useCashRegisterStore.getState().currentRegister?.transactions).toEqual([])
  })

  it("keeps a register row already in the store, transactions included (PRESERVE)", async () => {
    const full = { ...register, transactions: [{ id: "t-1" }] as never }
    useCashRegisterStore.setState({ currentRegister: full, registers: [full] })
    service.getOpenRegister.mockResolvedValue(register)

    const snapshots: Record<string, unknown>[] = []
    const unsubscribe = useCashRegisterStore.subscribe((state) => snapshots.push({ ...state }))
    await useCashRegisterStore.getState().loadOpenRegister()
    unsubscribe()

    // The cashier screen loads the FULL register in parallel; the delivery
    // screens must not overwrite it with the transaction-less row.
    expect(snapshots).toHaveLength(0)
    expect(useCashRegisterStore.getState().currentRegister?.transactions).toHaveLength(1)
  })

  it("leaves the store untouched when nothing is open (PRESERVE)", async () => {
    const closed = { ...register, status: "closed" as const }
    useCashRegisterStore.setState({ currentRegister: closed, registers: [closed] })
    service.getOpenRegister.mockResolvedValue(null)

    await useCashRegisterStore.getState().loadOpenRegister()

    expect(useCashRegisterStore.getState().currentRegister?.status).toBe("closed")
    expect(useCashRegisterStore.getState().isRegisterOpen()).toBe(false)
  })

  it("leaves the store untouched when the service throws (PRESERVE)", async () => {
    service.getOpenRegister.mockRejectedValue(new Error("network"))

    await expect(useCashRegisterStore.getState().loadOpenRegister()).resolves.toBeUndefined()

    expect(useCashRegisterStore.getState().currentRegister).toBeNull()
  })
})

describe("loadAllRegisters", () => {
  it("notifies subscribers once and replaces `registers` (PRESERVE)", async () => {
    service.getAllRegisters.mockResolvedValue([register])

    const snapshots: Record<string, unknown>[] = []
    const unsubscribe = useCashRegisterStore.subscribe((state) => snapshots.push({ ...state }))
    await useCashRegisterStore.getState().loadAllRegisters()
    unsubscribe()

    expect(snapshots).toHaveLength(1)
    expect(snapshots.every((s) => s.isLoading !== true)).toBe(true)
    expect(useCashRegisterStore.getState().registers.map((r) => r.id)).toEqual(["r-1"])
  })
})
describe("openRegister (T9: the server owns the one-open-register rule)", () => {
  it("asks the API even with an open register in the store, and rejects with the 409 message", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    service.openRegister.mockRejectedValue(
      new PaymentServiceError({ kind: "rejected", message: "A register is already open" }),
    )

    await expect(useCashRegisterStore.getState().openRegister(1000)).rejects.toMatchObject({
      kind: "rejected",
      message: "A register is already open",
    })

    expect(service.openRegister).toHaveBeenCalledWith(1000)
    expect(useCashRegisterStore.getState().currentRegister).toBe(register)
  })

  it("stores the opened register and resolves true (PRESERVE)", async () => {
    service.openRegister.mockResolvedValue(register)

    await expect(useCashRegisterStore.getState().openRegister(100)).resolves.toBe(true)

    expect(useCashRegisterStore.getState().currentRegister?.id).toBe("r-1")
  })
})

describe("closeRegister (T9: the server clock)", () => {
  it("keeps the server closingTimestamp and finalCash", async () => {
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
    const closedAt = new Date("2026-11-04T23:10:00.000Z")
    const summary = { expectedCashAfterTips: 60000 }
    payments.closeRegisterRpc.mockResolvedValue({
      status: "closed",
      cashRegisterId: "r-1",
      finalCash: 60000,
      closingTimestamp: closedAt,
      summary,
    })

    await expect(useCashRegisterStore.getState().closeRegister()).resolves.toBe(summary)

    expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1")
    const state = useCashRegisterStore.getState()
    expect(state.currentRegister).toBeNull()
    expect(state.registers[0]).toMatchObject({ status: "closed", finalCash: 60000, closingTimestamp: closedAt })
  })
})

describe("closeRegister with open orders (S1, S2)", () => {
  const closed = { status: "closed", cashRegisterId: "r-1", finalCash: 0, closingTimestamp: new Date(), summary: {} }

  beforeEach(() => {
    payments.closeRegisterRpc.mockReset()
    useCashRegisterStore.setState({ currentRegister: register, registers: [register] })
  })

  it("passes leaveOpenOrders to the API", async () => {
    payments.closeRegisterRpc.mockResolvedValue(closed)
    await useCashRegisterStore.getState().closeRegister({ leaveOpenOrders: true })
    expect(payments.closeRegisterRpc).toHaveBeenCalledWith("r-1", { leaveOpenOrders: true })
  })

  it("rethrows the 409 open_orders conflict and keeps the register open", async () => {
    const message = "Hay 2 órdenes abiertas. Cóbralas o cancélalas, o confirma que pasan a la siguiente caja."
    const conflict = new PaymentServiceError({
      kind: "unknown",
      message,
      cause: new ApiError(409, "Conflict", message, { code: "open_orders", count: 2, message }),
    })
    payments.closeRegisterRpc.mockRejectedValue(conflict)
    await expect(useCashRegisterStore.getState().closeRegister()).rejects.toBe(conflict)
    expect(useCashRegisterStore.getState().currentRegister).toBe(register)
  })

  it("still answers null on other errors", async () => {
    payments.closeRegisterRpc.mockRejectedValue(new Error("boom"))
    await expect(useCashRegisterStore.getState().closeRegister()).resolves.toBeNull()
  })
})
