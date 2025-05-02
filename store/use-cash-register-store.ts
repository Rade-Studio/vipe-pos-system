import { create } from "zustand"
import { persist } from "zustand/middleware"
import type {
  CashRegister,
  CashRegisterSummary,
  PaymentMethod,
  PaymentTransaction,
  CashTransaction,
} from "@/types/cash-register"
import { cashRegisterService } from "@/lib/supabase/cash-register-service"

type CashRegisterState = {
  currentRegister: CashRegister | null
  registers: CashRegister[]
  isLoading: boolean

  // Acciones de apertura y cierre
  openRegister: (initialCash: number) => Promise<boolean>
  closeRegister: () => Promise<CashRegisterSummary | null>

  // Acciones de transacciones
  addTransaction: (
    orderId: string,
    tableId: string,
    amount: number,
    method: PaymentMethod,
    cashReceived?: number,
    cashChange?: number,
    waiterId?: string,
    tipAmount?: number,
  ) => Promise<PaymentTransaction | null>

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
  getCurrentRegisterSummary: () => CashRegisterSummary | null
  getRegisterById: (id: string) => CashRegister | null
  getAllRegisters: () => CashRegister[]
  hasEnoughCashForChange: (changeAmount: number) => boolean

  // Carga de datos
  loadCurrentRegister: () => Promise<void>
  loadAllRegisters: () => Promise<void>
  loadTransactionsByRegisterId: (registerId: string) => Promise<PaymentTransaction[]>
  loadCashTransactionsByRegisterId: (registerId: string) => Promise<CashTransaction[]>
  loadTransactionsByDate: (
    date: Date,
  ) => Promise<
    (CashRegisterSummary & { transactions: PaymentTransaction[]; cashTransactions: CashTransaction[] }) | null
  >
}

export const useCashRegisterStore = create<CashRegisterState>()(
  persist(
    (set, get) => ({
      currentRegister: null,
      registers: [],
      isLoading: false,

      loadCurrentRegister: async () => {
        try {
          set({ isLoading: true })
          const register = await cashRegisterService.getCurrentRegister()
          if (register) {
            set({
              currentRegister: register,
              registers: [...get().registers.filter((r) => r.id !== register.id), register],
            })
          }
        } catch (error) {
          console.error("Error al cargar la caja actual:", error)
        } finally {
          set({ isLoading: false })
        }
      },

      loadAllRegisters: async () => {
        try {
          set({ isLoading: true })
          const registers = await cashRegisterService.getAllRegisters()
          set({ registers })
        } catch (error) {
          console.error("Error al cargar todas las cajas:", error)
        } finally {
          set({ isLoading: false })
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
            set({ currentRegister: { ...get().currentRegister, transactions } })
          }

          return transactions
        } catch (error) {
          console.error("Error al cargar transacciones:", error)
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
            set({ currentRegister: { ...get().currentRegister, cashTransactions } })
          }

          return cashTransactions
        } catch (error) {
          console.error("Error al cargar transacciones de efectivo:", error)
          return []
        }
      },

      loadTransactionsByDate: async (date: Date) => {
        try {
          set({ isLoading: true })

          // Crear fechas para el inicio y fin del día
          const startDate = new Date(date)
          startDate.setHours(0, 0, 0, 0)

          const endDate = new Date(date)
          endDate.setHours(23, 59, 59, 999)

          // Obtener transacciones para el rango de fechas
          const transactions = await cashRegisterService.getTransactionsByDateRange(startDate, endDate)

          // Obtener transacciones de efectivo para el rango de fechas
          const cashTransactions = await cashRegisterService.getCashTransactionsByDateRange(startDate, endDate)

          if ((!transactions || transactions.length === 0) && (!cashTransactions || cashTransactions.length === 0)) {
            return null
          }

          // Crear un registro temporal con las transacciones del día
          const tempRegister: CashRegister = {
            id: "temp-" + date.toISOString(),
            openingTimestamp: startDate,
            status: "open",
            initialCash: 0, // No tenemos este dato para días pasados
            transactions: transactions,
            cashTransactions: cashTransactions, // Ahora incluimos las transacciones de efectivo
          }

          // Calcular el resumen para este registro temporal
          const summary = cashRegisterService.calculateRegisterSummary(tempRegister)

          // Agregar las transacciones al resumen para poder exportarlas
          return {
            ...summary,
            transactions: transactions,
            cashTransactions: cashTransactions, // Incluimos las transacciones de efectivo en el resultado
          }
        } catch (error) {
          console.error("Error al cargar transacciones por fecha:", error)
          return null
        } finally {
          set({ isLoading: false })
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
          console.error("Error al abrir la caja:", error)
          return false
        }
      },

      closeRegister: async () => {
        const { currentRegister } = get()

        if (!currentRegister || currentRegister.status === "closed") {
          return null
        }

        try {
          // Calcular el resumen antes de cerrar la caja
          const summary = cashRegisterService.calculateRegisterSummary(currentRegister)

          if (!summary) return null

          // Cerrar la caja en Supabase
          await cashRegisterService.closeRegister(currentRegister.id, summary.finalCash)

          // Cerrar la caja localmente
          const closedRegister: CashRegister = {
            ...currentRegister,
            status: "closed",
            closingTimestamp: new Date(),
            finalCash: summary.finalCash,
          }

          set((state) => ({
            currentRegister: null,
            registers: state.registers.map((reg) => (reg.id === closedRegister.id ? closedRegister : reg)),
          }))

          return summary
        } catch (error) {
          console.error("Error al cerrar la caja:", error)
          return null
        }
      },

      addTransaction: async (orderId, tableId, amount, method, cashReceived, cashChange, waiterId, tipAmount) => {
        const { currentRegister } = get()

        if (!currentRegister || currentRegister.status === "closed") {
          return null
        }

        try {
          // Si es un pago en efectivo y hay cambio, verificar si hay suficiente efectivo
          if (method === "cash" && cashChange && cashChange > 0) {
            const hasEnough = get().hasEnoughCashForChange(cashChange)
            if (!hasEnough) {
              throw new Error("No hay suficiente efectivo en caja para dar el cambio")
            }
          }

          // Agregar transacción a Supabase
          const transaction = await cashRegisterService.addTransaction(
            currentRegister.id,
            orderId,
            tableId,
            amount,
            method,
            cashReceived,
            cashChange,
            waiterId,
            tipAmount,
          )

          // Actualizar el registro actual
          const updatedRegister: CashRegister = {
            ...currentRegister,
            transactions: [...currentRegister.transactions, transaction],
          }

          set((state) => ({
            currentRegister: updatedRegister,
            registers: state.registers.map((reg) => (reg.id === updatedRegister.id ? updatedRegister : reg)),
          }))

          return transaction
        } catch (error) {
          console.error("Error al agregar transacción:", error)
          throw error
        }
      },

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
          console.error("Error al agregar efectivo a la caja:", error)
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
          console.error("Error al agregar transacción de efectivo:", error)
          return null
        }
      },

      isRegisterOpen: () => {
        const { currentRegister } = get()
        return !!currentRegister && currentRegister.status === "open"
      },

      getCurrentRegisterSummary: () => {
        const { currentRegister } = get()

        if (!currentRegister) {
          return null
        }

        return cashRegisterService.calculateRegisterSummary(currentRegister)
      },

      // Función para verificar si hay suficiente efectivo para dar cambio
      hasEnoughCashForChange: (changeAmount: number) => {
        const summary = get().getCurrentRegisterSummary()
        if (!summary) return false

        return summary.finalCash >= changeAmount
      },

      getRegisterById: (id: string) => {
        return get().registers.find((reg) => reg.id === id) || null
      },

      getAllRegisters: () => {
        return get().registers
      },
    }),
    {
      name: "cash-register-storage",
      partialize: (state) => ({
        // Solo persistir algunos datos para evitar conflictos con Supabase
        registers: state.registers.map((register) => ({
          ...register,
          transactions: [], // No persistir transacciones localmente
          cashTransactions: [], // No persistir transacciones de efectivo localmente
        })),
      }),
    },
  ),
)
