import { supabase } from "./client"
import { log } from "@/lib/log"
import type {
  CashRegister,
  PaymentMethod,
  PaymentTransaction,
  CashTransaction,
} from "@/types/cash-register"

export const cashRegisterService = {
  async openRegister(initialCash: number): Promise<CashRegister> {
    try {
      log.info("Abriendo caja con efectivo inicial:", { initialCash })

      const newRegister = {
        opening_timestamp: new Date().toISOString(),
        initial_cash: initialCash,
        status: "open",
      }

      const { data, error } = await supabase.from("cash_registers").insert(newRegister).select().single()

      if (error) {
        log.error("Error al abrir caja:", { error: String(error) })
        throw error
      }

      log.info("Caja abierta con éxito:", { data })

      // Convertir el formato de la base de datos al formato del store
      return {
        id: data.id,
        openingTimestamp: new Date(data.opening_timestamp),
        initialCash: data.initial_cash,
        status: "open" as "open" | "closed",
        transactions: [],
        cashTransactions: [],
        created_at: data.created_at ? new Date(data.created_at) : undefined,
        updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
      }
    } catch (error) {
      log.error("Error en openRegister:", { error: String(error) })
      throw error
    }
  },

  async closeRegister(registerId: string, finalCash: number): Promise<void> {
    try {
      log.info("Cerrando caja:", { registerId, finalCash })

      const { error } = await supabase
        .from("cash_registers")
        .update({
          closing_timestamp: new Date().toISOString(),
          final_cash: finalCash,
          status: "closed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", registerId)

      if (error) {
        log.error("Error al cerrar caja:", { error: String(error) })
        throw error
      }

      log.info("Caja cerrada con éxito")
    } catch (error) {
      log.error("Error en closeRegister:", { error: String(error) })
      throw error
    }
  },

  async getCurrentRegister(): Promise<CashRegister | null> {
    try {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("*")
        .eq("status", "open")
        .order("opening_timestamp", { ascending: false })
        .limit(1)
        .single()

      if (error) {
        // Si no hay caja abierta, no es un error
        if (error.code === "PGRST116") {
          return null
        }

        throw error
      }

      // Obtener las transacciones asociadas a esta caja
      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (transactionsError) {
        throw transactionsError
      }

      // Obtener las transacciones de efectivo asociadas a esta caja
      const { data: cashTransactions, error: cashTransactionsError } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (cashTransactionsError) {
        throw cashTransactionsError
      }

      // Convertir el formato de la base de datos al formato del store
      return {
        id: data.id,
        openingTimestamp: new Date(data.opening_timestamp),
        closingTimestamp: data.closing_timestamp ? new Date(data.closing_timestamp) : undefined,
        initialCash: data.initial_cash,
        finalCash: data.final_cash || undefined,
        status: data.status as "open" | "closed",
        transactions: transactions
          ? transactions.map((t) => ({
              id: t.id,
              orderId: t.order_id,
              tableId: t.table_id ?? "",
              waiterId: t.waiter_id ?? undefined,
              amount: t.amount,
              tipAmount: t.tip_amount ?? undefined,
              method: t.method as PaymentMethod,
              cashReceived: t.cash_received ?? undefined,
              cashChange: t.cash_change ?? undefined,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type as "deposit" | "withdrawal",
              description: t.description ?? "",
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        created_at: data.created_at ? new Date(data.created_at) : undefined,
        updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
      }
    } catch (error) {
      log.error("Error en getCurrentRegister:", { error: String(error) })
      throw error
    }
  },

  async getAllRegisters(): Promise<CashRegister[]> {
    try {
      const { data, error } = await supabase
        .from("cash_registers")
        .select("*")
        .order("opening_timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener todas las cajas:", { error: String(error) })
        throw error
      }

      // Cargar todas las transacciones
      const transactions = await this.loadTransactionsForRegisters(data.map(r => r.id))

      log.info("Cajas obtenidas:", { count: data.length })
      log.info("------------------- data -------------------", { data })

      // Convertir el formato de la base de datos al formato del store
      return data.map((register) => ({
        id: register.id,
        openingTimestamp: new Date(register.opening_timestamp),
        closingTimestamp: register.closing_timestamp ? new Date(register.closing_timestamp) : undefined,
        initialCash: register.initial_cash,
        finalCash: register.final_cash || undefined,
        status: register.status as "open" | "closed",
        transactions:  transactions.transactions.filter(t => t.cash_register_id === register.id),
        cashTransactions: transactions.cashTransactions.filter(t => t.cash_register_id === register.id),
        created_at: register.created_at ? new Date(register.created_at) : undefined,
        updated_at: register.updated_at ? new Date(register.updated_at) : undefined,
      }))
    } catch (error) {
      log.error("Error en getAllRegisters:", { error: String(error) })
      throw error
    }
  },

  async getRegisterById(registerId: string): Promise<CashRegister | null> {
    try {
      log.info("Obteniendo caja por ID:", { registerId })

      const { data, error } = await supabase.from("cash_registers").select("*").eq("id", registerId).single()

      if (error) {
        log.error("Error al obtener caja por ID:", { error: String(error) })
        throw error
      }

      // Obtener las transacciones asociadas a esta caja
      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (transactionsError) {
        log.error("Error al obtener transacciones:", { transactionsError: String(transactionsError) })
        throw transactionsError
      }

      // Obtener las transacciones de efectivo asociadas a esta caja
      const { data: cashTransactions, error: cashTransactionsError } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (cashTransactionsError) {
        log.error("Error al obtener transacciones de efectivo:", { cashTransactionsError: String(cashTransactionsError) })
        throw cashTransactionsError
      }

      // Convertir el formato de la base de datos al formato del store
      return {
        id: data.id,
        openingTimestamp: new Date(data.opening_timestamp),
        closingTimestamp: data.closing_timestamp ? new Date(data.closing_timestamp) : undefined,
        initialCash: data.initial_cash,
        finalCash: data.final_cash || undefined,
        status: data.status as "open" | "closed",
        transactions: transactions
          ? transactions.map((t) => ({
              id: t.id,
              orderId: t.order_id,
              tableId: t.table_id ?? "",
              waiterId: t.waiter_id ?? undefined,
              amount: t.amount,
              tipAmount: t.tip_amount ?? undefined,
              method: t.method as PaymentMethod,
              cashReceived: t.cash_received ?? undefined,
              cashChange: t.cash_change ?? undefined,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type as "deposit" | "withdrawal",
              description: t.description ?? "",
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        created_at: data.created_at ? new Date(data.created_at) : undefined,
        updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
      }
    } catch (error) {
      log.error("Error en getRegisterById:", { error: String(error) })
      throw error
    }
  },

  // Nuevo método para obtener cajas por fecha
  async getRegistersByDate(date: Date): Promise<CashRegister[]> {
    try {
      log.info("Obteniendo cajas por fecha:", { date: date.toISOString() })

      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)

      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const { data, error } = await supabase
        .from("cash_registers")
        .select("*")
        .gte("opening_timestamp", startOfDay.toISOString())
        .lte("opening_timestamp", endOfDay.toISOString())
        .order("opening_timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener cajas por fecha:", { error: String(error) })
        throw error
      }

      log.info("Cajas obtenidas por fecha:", { count: data.length })

      // Convertir el formato de la base de datos al formato del store
      return data.map((register) => ({
        id: register.id,
        openingTimestamp: new Date(register.opening_timestamp),
        closingTimestamp: register.closing_timestamp ? new Date(register.closing_timestamp) : undefined,
        initialCash: register.initial_cash,
        finalCash: register.final_cash || undefined,
        status: register.status as "open" | "closed",
        transactions: [], // No cargamos las transacciones para todas las cajas por eficiencia
        cashTransactions: [], // No cargamos las transacciones de efectivo para todas las cajas por eficiencia
        created_at: register.created_at ? new Date(register.created_at) : undefined,
        updated_at: register.updated_at ? new Date(register.updated_at) : undefined,
      }))
    } catch (error) {
      log.error("Error en getRegistersByDate:", { error: String(error) })
      throw error
    }
  },

  // Método para cargar transacciones y transacciones de efectivo para múltiples cajas
  async loadTransactionsForRegisters(registerIds: string[]): Promise<{
    transactions: PaymentTransaction[]
    cashTransactions: CashTransaction[]
  }> {
    try {
      log.info("Cargando transacciones para cajas:", { registerIds })

      // Obtener todas las transacciones para los IDs de caja proporcionados
      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("*")
        .in("cash_register_id", registerIds)
        .order("timestamp", { ascending: false })

      if (transactionsError) {
        log.error("Error al obtener transacciones:", { transactionsError: String(transactionsError) })
        throw transactionsError
      }

      // Obtener todas las transacciones de efectivo para los IDs de caja proporcionados
      const { data: cashTransactions, error: cashTransactionsError } = await supabase
        .from("cash_transactions")
        .select("*")
        .in("cash_register_id", registerIds)
        .order("timestamp", { ascending: false })

      if (cashTransactionsError) {
        log.error("Error al obtener transacciones de efectivo:", { cashTransactionsError: String(cashTransactionsError) })
        throw cashTransactionsError
      }

      // Convertir el formato de la base de datos al formato del store
      return {
        transactions: transactions
          ? transactions.map((t) => ({
              id: t.id,
              orderId: t.order_id,
              tableId: t.table_id ?? "",
              waiterId: t.waiter_id ?? undefined,
              amount: t.amount,
              tipAmount: t.tip_amount ?? undefined,
              method: t.method as PaymentMethod,
              cashReceived: t.cash_received ?? undefined,
              cashChange: t.cash_change ?? undefined,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type as "deposit" | "withdrawal",
              description: t.description ?? "",
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
      }
    } catch (error) {
      log.error("Error en loadTransactionsForRegisters:", { error: String(error) })
      throw error
    }
  },

  // Legacy `addTransaction` was removed in task 8c: the only writer of
  // public.payment_transactions is the retired public.complete_payment
  // RPC, which dropped, and the only writer of public.payments is the
  // server-side `pay_order` RPC. The browser never writes a transaction
  // row from a client action any more (see
  // `lib/supabase/payments-service.ts`).

  // Actualizar la función getTransactionsByRegisterId para incluir waiterId y tipAmount

  // Nueva función para agregar transacciones de efectivo (ingresos o retiros)
  async addCashTransaction(
    registerId: string,
    amount: number,
    type: "deposit" | "withdrawal",
    description: string,
  ): Promise<CashTransaction> {
    try {
      log.info("Agregando transacción de efectivo a caja:", { registerId,
        amount,
        type,
        description,
      })

      const transaction = {
        amount: amount,
        type: type,
        description: description,
        timestamp: new Date().toISOString(),
        cash_register_id: registerId,
      }

      const { data, error } = await supabase.from("cash_transactions").insert(transaction).select().single()

      if (error) {
        log.error("Error al agregar transacción de efectivo:", { error: String(error) })
        throw error
      }

      log.info("Transacción de efectivo agregada con éxito:", { data })

      // Convertir el formato de la base de datos al formato del store
      return {
        id: data.id,
        amount: data.amount,
        type: data.type as "deposit" | "withdrawal",
        description: data.description ?? "",
        timestamp: new Date(data.timestamp),
        cash_register_id: data.cash_register_id,
      }
    } catch (error) {
      log.error("Error en addCashTransaction:", { error: String(error) })
      throw error
    }
  },

  // Actualizar la función getTransactionsByRegisterId para incluir waiterId y tipAmount
  async getTransactionsByRegisterId(registerId: string): Promise<PaymentTransaction[]> {
    try {
      log.info("Obteniendo transacciones para caja:", { registerId })

      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("cash_register_id", registerId)
        .order("timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener transacciones:", { error: String(error) })
        throw error
      }

      log.info("Transacciones obtenidas:", { count: data.length })

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id ?? "",
        waiterId: t.waiter_id ?? undefined,
        amount: t.amount,
        tipAmount: t.tip_amount ?? undefined,
        method: t.method as PaymentMethod,
        cashReceived: t.cash_received ?? undefined,
        cashChange: t.cash_change ?? undefined,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getTransactionsByRegisterId:", { error: String(error) })
      throw error
    }
  },

  // Nueva función para obtener transacciones de efectivo por ID de caja
  async getCashTransactionsByRegisterId(registerId: string): Promise<CashTransaction[]> {
    try {
      log.info("Obteniendo transacciones de efectivo para caja:", { registerId })

      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("cash_register_id", registerId)
        .order("timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener transacciones de efectivo:", { error: String(error) })
        throw error
      }

      log.info("Transacciones de efectivo obtenidas:", { count: data.length })

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type as "deposit" | "withdrawal",
        description: t.description ?? "",
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getCashTransactionsByRegisterId:", { error: String(error) })
      throw error
    }
  },

  async getTransactionsByOrderId(orderId: string): Promise<PaymentTransaction[]> {
    try {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("order_id", orderId)
        .order("timestamp", { ascending: true })

      if (error) {
        log.error("Error al obtener transacciones por orden:", { error: String(error) })
        throw error
      }

      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id ?? "",
        waiterId: t.waiter_id ?? undefined,
        amount: t.amount,
        tipAmount: t.tip_amount ?? undefined,
        method: t.method as PaymentMethod,
        cashReceived: t.cash_received ?? undefined,
        cashChange: t.cash_change ?? undefined,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getTransactionsByOrderId:", { error: String(error) })
      throw error
    }
  },

  // Actualizar la función getTransactionsByDateRange para incluir waiterId y tipAmount
  async getTransactionsByDateRange(startDate: Date, endDate: Date): Promise<PaymentTransaction[]> {
    try {
      log.info("Obteniendo transacciones por rango de fechas:", { startDate: startDate.toISOString(), endDate: endDate.toISOString() })

      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .gte("timestamp", startDate.toISOString())
        .lte("timestamp", endDate.toISOString())
        .order("timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener transacciones por rango de fechas:", { error: String(error) })
        throw error
      }

      log.info("Transacciones obtenidas:", { count: data.length })

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id ?? "",
        waiterId: t.waiter_id ?? undefined,
        amount: t.amount,
        tipAmount: t.tip_amount ?? undefined,
        method: t.method as PaymentMethod,
        cashReceived: t.cash_received ?? undefined,
        cashChange: t.cash_change ?? undefined,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getTransactionsByDateRange:", { error: String(error) })
      throw error
    }
  },

  async getCashTransactionsByDateRange(startDate: Date, endDate: Date): Promise<CashTransaction[]> {
    try {
      log.info(
        "Obteniendo transacciones de efectivo por rango de fechas:",
        { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
      )

      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .gte("timestamp", startDate.toISOString())
        .lte("timestamp", endDate.toISOString())
        .order("timestamp", { ascending: false })

      if (error) {
        log.error("Error al obtener transacciones de efectivo por rango de fechas:", { error: String(error) })
        throw error
      }

      log.info("Transacciones de efectivo obtenidas:", { count: data.length })

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type as "deposit" | "withdrawal",
        description: t.description ?? "",
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getCashTransactionsByDateRange:", { error: String(error) })
      throw error
    }
  },

  async getTransactionsByRegisters(registers: string[]): Promise<PaymentTransaction[]> {
    try {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .in("cash_register_id", registers)
        .order("timestamp", { ascending: false })

      if (error) throw error

      // Transformar los datos de la base de datos al formato de la aplicación
      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id ?? "",
        waiterId: t.waiter_id ?? undefined,
        amount: t.amount,
        tipAmount: t.tip_amount ?? undefined,
        method: t.method as PaymentMethod,
        cashReceived: t.cash_received ?? undefined,
        cashChange: t.cash_change ?? undefined,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getTransactionsByRegisters:", { error: String(error) })
      throw error
    }
  },

  async getCashTransactionsByRegisters(registers: string[]): Promise<CashTransaction[]> {
    try {
      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .in("cash_register_id", registers)
        .order("timestamp", { ascending: false })

      if (error) throw error

      // Transformar los datos de la base de datos al formato de la aplicación
      return data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type as "deposit" | "withdrawal",
        description: t.description ?? "",
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      log.error("Error en getCashTransactionsByRegisters:", { error: String(error) })
      throw error
    }
  },

  // El agregado multi-registro ahora lo calcula el servidor (ver
  // Legacy `calculateRegisterSummary` (multi- and single-register) was
  // removed in task 8c: the server's `register_summary` RPC is the only
  // authority on totals, tips and expected cash (see
  // `lib/supabase/payments-service.ts` and `useRegisterSummary`). The
  // store dropped its `loadTransactionsByDate` / `loadTransactionsByRegisters`
  // shims; the cashier/admin screens consume the new ledger through
  // `useRegisterPayments` and the legacy rows through `getTransactionsByRegisters`.

  currentRegisterId: null,
}
