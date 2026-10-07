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
  getAllRegisters: vi.fn(),
  getTransactionsByRegisterId: vi.fn(),
  getCashTransactionsByRegisterId: vi.fn(),
  openRegister: vi.fn(),
  addCashTransaction: vi.fn(),
}))

vi.mock("@/lib/supabase/cash-register-service", () => ({
  cashRegisterService: service,
}))

// The store reaches the browser client through payments-service (closeRegister
// RPC); nothing in this suite exercises it, but the import must not throw.
vi.mock("@/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
  createSupabaseClient: () => ({}),
}))

import { useCashRegisterStore } from "./use-cash-register-store"

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