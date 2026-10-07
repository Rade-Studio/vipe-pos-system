import { create } from "zustand"
import { persist } from "zustand/middleware"
import type {
  CashRegister,
  PaymentTransaction,
  CashTransaction,
} from "@/types/cash-register"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"
import { log } from "@/lib/log"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { closeRegisterRpc } from "@/lib/supabase/payments-service"

type CashRegisterState = {
  currentRegister: CashRegister | null
  registers: CashRegister[]

  // Acciones de apertura y cierre
  openRegister: (initialCash: number) => Promise<boolean>
  /**
   * Server-driven close. Returns the `RegisterSummary` the
   * `close_register` RPC computed at the FOR-UPDATE lock instant,
   * or `null` if there is no open register / the RPC rejected.
   * `finalCash` lives on the returned summary's `expectedCashAfterTips`
   * (the value the server stored in `cash_registers.final_cash`).
   */
  closeRegister: () => Promise<RegisterSummary | null>

  // Acciones para transacciones de efectivo
  addCashToRegister: (amount: number) => Promise<boolean>
  addCashTransaction: (
    registerId: string,
    amount: number,
    type: "deposit" | "withdrawal",
    description: string,
  ) => Promise<CashTransaction | null>

  // Consultas
  isRegisterOpen: () => boolean
  getRegisterById: (id: string) => CashRegister | null
  getAllRegisters: () => CashRegister[]

  // Carga de datos
  loadCurrentRegister: () => Promise<void>
  /**
   * T10 (S1): the lightweight open/closed check — ONE request instead of the
   * three `loadCurrentRegister` issues. Use it when the screen only needs to
   * know whether a register is open (delivery board, cashier delivery panel).
   *
   * Two rules keep it safe next to the full load:
   *   - a row already in the store for the same register is left untouched,
   *     so the cashier screen's full load (which carries the transaction
   *     histories the "Transacciones" tab renders) is never overwritten by this
   *     transaction-less row;
   *   - when nothing is open the store is left exactly as `loadCurrentRegister`
   *     leaves it (untouched), so `isRegisterOpen()` keeps its meaning.
   */
  loadOpenRegister: () => Promise<void>
  loadAllRegisters: () => Promise<void>
  loadTransactionsByRegisterId: (registerId: string) => Promise<PaymentTransaction[]>
  loadCashTransactionsByRegisterId: (registerId: string) => Promise<CashTransaction[]>
}

export const useCashRegisterStore = create<CashRegisterState>()(

    (set, get) => ({
      currentRegister: null,
      registers: [],

      // Neither load flips a shared `isLoading` any more. All twelve
      // `useCashRegisterStore()` consumers read the store without a selector,
      // so every extra `set` re-rendered all of them, and running both loads in
      // parallel from the shell made the flag bounce while each finished. No
      // component read it (the cashier/admin/delivery screens use their own
      // local flag or a React Query one), so the observable contract is the
      // register data itself.

      loadCurrentRegister: async () => {
        try {
          const register = await cashRegisterService.getCurrentRegister()
          if (register) {
            set({
              currentRegister: register,
              registers: [...get().registers.filter((r) => r.id !== register.id), register],
            })
          }
        } catch (error) {
          log.error("Error al cargar la caja actual:", { error: String(error) })
        }
      },

      loadOpenRegister: async () => {
        try {
          const register = await cashRegisterService.getOpenRegister()
          // Sin caja abierta: `loadCurrentRegister` tampoco escribe nada, así
          // que el store queda igual y `isRegisterOpen()` sigue siendo la
          // fuente de verdad.
          if (!register) return
          if (get().currentRegister?.id === register.id) return
          set({
            currentRegister: register,
            registers: [...get().registers.filter((r) => r.id !== register.id), register],
          })
        } catch (error) {
          log.error("Error al verificar la caja abierta:", { error: String(error) })
        }
      },

      loadAllRegisters: async () => {
        try {
          const registers = await cashRegisterService.getAllRegisters()
          set({ registers })
        } catch (error) {
          log.error("Error al cargar todas las cajas:", { error: String(error) })
        }
      },

      loadTransactionsByRegisterId: async (registerId: string) => {
        try {
          const transactions = await cashRegisterService.getTransactionsByRegisterId(registerId)

          // Actualizar el registro con las transacciones
          const updatedRegisters = get().registers.map((register) => {
            if (register.id === registerId) {
              return { ...register, transactions }
            }
            return register
          })

          set({ registers: updatedRegisters })

          // Si es el registro actual, actualizarlo también
          if (get().currentRegister?.id === registerId) {
            set({ currentRegister: { ...get().currentRegister, transactions } as any })
          }

          return transactions
        } catch (error) {
          log.error("Error al cargar transacciones:", { error: String(error) })
          return []
        }
      },

      loadCashTransactionsByRegisterId: async (registerId: string) => {
        try {
          const cashTransactions = await cashRegisterService.getCashTransactionsByRegisterId(registerId)

          // Actualizar el registro con las transacciones de efectivo
          const updatedRegisters = get().registers.map((register) => {
            if (register.id === registerId) {
              return { ...register, cashTransactions }
            }
            return register
          })

          set({ registers: updatedRegisters })

          // Si es el registro actual, actualizarlo también
          if (get().currentRegister?.id === registerId) {
            set({ currentRegister: { ...get().currentRegister, cashTransactions } as any })
          }

          return cashTransactions
        } catch (error) {
          log.error("Error al cargar transacciones de efectivo:", { error: String(error) })
          return []
        }
      },

      openRegister: async (initialCash: number) => {
        try {
          // Verificar si ya hay una caja abierta
          if (get().currentRegister?.status === "open") {
            return false
          }

          const newRegister = await cashRegisterService.openRegister(initialCash)

          set((state) => ({
            currentRegister: newRegister,
            registers: [...state.registers.filter((r) => r.id !== newRegister.id), newRegister],
          }))

          return true
        } catch (error) {
          log.error("Error al abrir la caja:", { error: String(error) })
          return false
        }
      },

      /**
       * Server-driven close. Calls the `close_register` RPC, which
       * takes the row lock, computes the snapshot, UPDATEs the
       * register, and returns the final_cash (= expected_cash_after_tips)
       * the UI should display. The browser does NOT recompute anything
       * from the local transactions.
       */
      closeRegister: async () => {
        const { currentRegister } = get()
        if (!currentRegister || currentRegister.status === "closed") {
          return null
        }

        try {
          const result = await closeRegisterRpc(currentRegister.id)

          const closedRegister: CashRegister = {
            ...currentRegister,
            status: "closed",
            closingTimestamp: new Date(),
            finalCash: result.finalCash,
          }

          set((state) => ({
            currentRegister: null,
            registers: state.registers.map((reg) => (reg.id === closedRegister.id ? closedRegister : reg)),
          }))

          return result.summary
        } catch (error) {
          log.error("Error al cerrar la caja:", { error: String(error) })
          return null
        }
      },

      // Legacy `addTransaction` was removed in task 8c: the only writer of
      // public.payments is the server-side `pay_order` RPC, so the browser
      // never writes a transaction from any client action. The legacy
      // `payment_transactions` rows remain readable as a separate history
      // block on the cashier/admin screens.

      // Función para agregar efectivo a la caja
      addCashToRegister: async (amount: number) => {
        const { currentRegister } = get()

        if (!currentRegister || currentRegister.status === "closed") {
          return false
        }

        try {
          // Agregar transacción de efectivo a Supabase
          const cashTransaction = await cashRegisterService.addCashTransaction(
            currentRegister.id,
            amount,
            "deposit",
            "Ingreso adicional de efectivo a caja",
          )

          // Actualizar el registro actual
          const updatedRegister: CashRegister = {
            ...currentRegister,
            cashTransactions: [...currentRegister.cashTransactions, cashTransaction],
          }

          set((state) => ({
            currentRegister: updatedRegister,
            registers: state.registers.map((reg) => (reg.id === updatedRegister.id ? updatedRegister : reg)),
          }))

          return true
        } catch (error) {
          log.error("Error al agregar efectivo a la caja:", { error: String(error) })
          return false
        }
      },

      // Nueva función para agregar transacciones de efectivo (ingresos o retiros)
      addCashTransaction: async (registerId, amount, type, description) => {
        try {
          // Agregar transacción de efectivo a Supabase
          const cashTransaction = await cashRegisterService.addCashTransaction(registerId, amount, type, description)

          // Obtener el registro actual
          const currentRegister = get().currentRegister

          // Si el registro actual es el mismo que estamos modificando, actualizarlo
          if (currentRegister && currentRegister.id === registerId) {
            const updatedRegister: CashRegister = {
              ...currentRegister,
              cashTransactions: [...currentRegister.cashTransactions, cashTransaction],
            }

            set((state) => ({
              currentRegister: updatedRegister,
              registers: state.registers.map((reg) => (reg.id === updatedRegister.id ? updatedRegister : reg)),
            }))
          }

          return cashTransaction
        } catch (error) {
          log.error("Error al agregar transacción de efectivo:", { error: String(error) })
          return null
        }
      },

      isRegisterOpen: () => {
        const { currentRegister } = get()
        return !!currentRegister && currentRegister.status === "open"
      },

      getRegisterById: (id: string) => {
        return get().registers.find((reg) => reg.id === id) || null
      },

      getAllRegisters: () => {
        return get().registers
      },
    }),
)