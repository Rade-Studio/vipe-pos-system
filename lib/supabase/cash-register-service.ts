import { supabase } from "./client"
import type {
  CashRegister,
  CashRegisterSummary,
  PaymentMethod,
  PaymentTransaction,
  CashTransaction,
} from "@/types/cash-register"

export const cashRegisterService = {
  async openRegister(initialCash: number): Promise<CashRegister> {
    try {
      console.log("Abriendo caja con efectivo inicial:", initialCash)

      const newRegister = {
        opening_timestamp: new Date().toISOString(),
        initial_cash: initialCash,
        status: "open",
      }

      const { data, error } = await supabase.from("cash_registers").insert(newRegister).select().single()

      if (error) {
        console.error("Error al abrir caja:", error)
        throw error
      }

      console.log("Caja abierta con éxito:", data)

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
      console.error("Error en openRegister:", error)
      throw error
    }
  },

  async closeRegister(registerId: string, finalCash: number): Promise<void> {
    try {
      console.log("Cerrando caja:", registerId, "con efectivo final:", finalCash)

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
        console.error("Error al cerrar caja:", error)
        throw error
      }

      console.log("Caja cerrada con éxito")
    } catch (error) {
      console.error("Error en closeRegister:", error)
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
              tableId: t.table_id,
              waiterId: t.waiter_id,
              amount: t.amount,
              tipAmount: t.tip_amount,
              method: t.method,
              cashReceived: t.cash_received,
              cashChange: t.cash_change,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type,
              description: t.description,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        created_at: data.created_at ? new Date(data.created_at) : undefined,
        updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
      }
    } catch (error) {
      console.error("Error en getCurrentRegister:", error)
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
        console.error("Error al obtener todas las cajas:", error)
        throw error
      }

      // Cargar todas las transacciones
      const transactions = await this.loadTransactionsForRegisters(data.map(r => r.id))

      console.log("Cajas obtenidas:", data.length)
      console.log("------------------- data -------------------", data)

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
      console.error("Error en getAllRegisters:", error)
      throw error
    }
  },

  async getRegisterById(registerId: string): Promise<CashRegister | null> {
    try {
      console.log("Obteniendo caja por ID:", registerId)

      const { data, error } = await supabase.from("cash_registers").select("*").eq("id", registerId).single()

      if (error) {
        console.error("Error al obtener caja por ID:", error)
        throw error
      }

      // Obtener las transacciones asociadas a esta caja
      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (transactionsError) {
        console.error("Error al obtener transacciones:", transactionsError)
        throw transactionsError
      }

      // Obtener las transacciones de efectivo asociadas a esta caja
      const { data: cashTransactions, error: cashTransactionsError } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("cash_register_id", data.id)
        .order("timestamp", { ascending: false })

      if (cashTransactionsError) {
        console.error("Error al obtener transacciones de efectivo:", cashTransactionsError)
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
              tableId: t.table_id,
              waiterId: t.waiter_id,
              amount: t.amount,
              tipAmount: t.tip_amount,
              method: t.method,
              cashReceived: t.cash_received,
              cashChange: t.cash_change,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type,
              description: t.description,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        created_at: data.created_at ? new Date(data.created_at) : undefined,
        updated_at: data.updated_at ? new Date(data.updated_at) : undefined,
      }
    } catch (error) {
      console.error("Error en getRegisterById:", error)
      throw error
    }
  },

  // Nuevo método para obtener cajas por fecha
  async getRegistersByDate(date: Date): Promise<CashRegister[]> {
    try {
      console.log("Obteniendo cajas por fecha:", date.toISOString())

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
        console.error("Error al obtener cajas por fecha:", error)
        throw error
      }

      console.log("Cajas obtenidas por fecha:", data.length)

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
      console.error("Error en getRegistersByDate:", error)
      throw error
    }
  },

  // Método para cargar transacciones y transacciones de efectivo para múltiples cajas
  async loadTransactionsForRegisters(registerIds: string[]): Promise<{
    transactions: PaymentTransaction[]
    cashTransactions: CashTransaction[]
  }> {
    try {
      console.log("Cargando transacciones para cajas:", registerIds)

      // Obtener todas las transacciones para los IDs de caja proporcionados
      const { data: transactions, error: transactionsError } = await supabase
        .from("payment_transactions")
        .select("*")
        .in("cash_register_id", registerIds)
        .order("timestamp", { ascending: false })

      if (transactionsError) {
        console.error("Error al obtener transacciones:", transactionsError)
        throw transactionsError
      }

      // Obtener todas las transacciones de efectivo para los IDs de caja proporcionados
      const { data: cashTransactions, error: cashTransactionsError } = await supabase
        .from("cash_transactions")
        .select("*")
        .in("cash_register_id", registerIds)
        .order("timestamp", { ascending: false })

      if (cashTransactionsError) {
        console.error("Error al obtener transacciones de efectivo:", cashTransactionsError)
        throw cashTransactionsError
      }

      // Convertir el formato de la base de datos al formato del store
      return {
        transactions: transactions
          ? transactions.map((t) => ({
              id: t.id,
              orderId: t.order_id,
              tableId: t.table_id,
              waiterId: t.waiter_id,
              amount: t.amount,
              tipAmount: t.tip_amount,
              method: t.method,
              cashReceived: t.cash_received,
              cashChange: t.cash_change,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
        cashTransactions: cashTransactions
          ? cashTransactions.map((t) => ({
              id: t.id,
              amount: t.amount,
              type: t.type,
              description: t.description,
              timestamp: new Date(t.timestamp),
              cash_register_id: t.cash_register_id,
            }))
          : [],
      }
    } catch (error) {
      console.error("Error en loadTransactionsForRegisters:", error)
      throw error
    }
  },

  // Actualizar la función addTransaction para incluir waiterId y tipAmount
  async addTransaction(
      registerId: string,
      orderId: string,
      tableId: string,
      amount: number, // Este 'amount' principal solo se usa si el método NO es 'multiple'
      method: PaymentMethod | "multiple",
      paymentsMethod?: Record<PaymentMethod, boolean> | undefined,
      paymentsAmount?: Record<PaymentMethod, string> | undefined, // Se mantiene como string por si viene de un input de texto
      cashReceived?: number,
      cashChange?: number,
      waiterId?: string,
      tipAmount?: number,
  ): Promise<PaymentTransaction[]> { // Cambia el tipo de retorno a un array de transacciones
    try {
      const transactionsToInsert: any[] = [];

      if (method === "multiple" && paymentsMethod && paymentsAmount) {
        console.log("Múltiples pagos:", paymentsMethod, paymentsAmount);
        // Lógica para múltiples métodos de pago
        const countMethodsTrue = Object.values(paymentsMethod).filter((isTrue) => isTrue).length;
        const tipAmountDist = countMethodsTrue > 1 && tipAmount ? Math.round(Number(tipAmount) / countMethodsTrue) : undefined; // Si hay más de un método de pago, el tipo no se puede distribuir
        for (const [paymentMethodKey, isTrue] of Object.entries(paymentsMethod)) {
          if (isTrue) {
            const currentMethod = paymentMethodKey as PaymentMethod;
            const currentAmountStr = paymentsAmount[currentMethod];
            const currentAmount = parseFloat(currentAmountStr);

            if (isNaN(currentAmount) || currentAmount <= 0) {
              continue; // Salta esta iteración si el monto no es válido
            }

            transactionsToInsert.push({
              order_id: orderId,
              table_id: tableId,
              waiter_id: waiterId,
              amount: currentAmount,
              method: currentMethod,
              cash_received: currentMethod === "cash" ? cashReceived : undefined, // Solo si es efectivo
              cash_change: currentMethod === "cash" ? cashChange : undefined, // Solo si es efectivo
              timestamp: new Date().toISOString(),
              cash_register_id: registerId,
              tip_amount: tipAmountDist, // Si hay más de un método de pago se distribuye la propina
            });
          }
        }
      } else {
        // Lógica para un único método de pago
        transactionsToInsert.push({
          order_id: orderId,
          table_id: tableId,
          waiter_id: waiterId,
          amount: amount,
          tip_amount: tipAmount || 0,
          method: method,
          cash_received: cashReceived,
          cash_change: cashChange,
          timestamp: new Date().toISOString(),
          cash_register_id: registerId,
        });
      }

      if (transactionsToInsert.length === 0) {
        throw new Error("No hay transacciones válidas para insertar.");
      }

      console.log("Transacciones a insertar:", transactionsToInsert);

      const {data, error} = await supabase.from("payment_transactions").insert(transactionsToInsert).select();

      if (error) {
        console.error("Error al agregar transacción(es):", error);
        throw error;
      }

      console.log("Transacción(es) agregada(s) con éxito:", data);

      // Convertir el formato de la base de datos al formato del store para cada transacción
      return data.map((d: any) => ({
        id: d.id,
        orderId: d.order_id,
        tableId: d.table_id,
        waiterId: d.waiter_id,
        amount: d.amount,
        tipAmount: d.tip_amount,
        method: d.method,
        cashReceived: d.cash_received,
        cashChange: d.cash_change,
        timestamp: new Date(d.timestamp),
        cash_register_id: d.cash_register_id,
      }));
    } catch (error) {
      console.error("Error en addTransaction:", error);
      throw error;
    }
  },

  // Nueva función para agregar transacciones de efectivo (ingresos o retiros)
  async addCashTransaction(
    registerId: string,
    amount: number,
    type: "deposit" | "withdrawal",
    description: string,
  ): Promise<CashTransaction> {
    try {
      console.log("Agregando transacción de efectivo a caja:", registerId, {
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
        console.error("Error al agregar transacción de efectivo:", error)
        throw error
      }

      console.log("Transacción de efectivo agregada con éxito:", data)

      // Convertir el formato de la base de datos al formato del store
      return {
        id: data.id,
        amount: data.amount,
        type: data.type,
        description: data.description,
        timestamp: new Date(data.timestamp),
        cash_register_id: data.cash_register_id,
      }
    } catch (error) {
      console.error("Error en addCashTransaction:", error)
      throw error
    }
  },

  // Actualizar la función getTransactionsByRegisterId para incluir waiterId y tipAmount
  async getTransactionsByRegisterId(registerId: string): Promise<PaymentTransaction[]> {
    try {
      console.log("Obteniendo transacciones para caja:", registerId)

      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .eq("cash_register_id", registerId)
        .order("timestamp", { ascending: false })

      if (error) {
        console.error("Error al obtener transacciones:", error)
        throw error
      }

      console.log("Transacciones obtenidas:", data.length)

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id,
        waiterId: t.waiter_id,
        amount: t.amount,
        tipAmount: t.tip_amount,
        method: t.method,
        cashReceived: t.cash_received,
        cashChange: t.cash_change,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getTransactionsByRegisterId:", error)
      throw error
    }
  },

  // Nueva función para obtener transacciones de efectivo por ID de caja
  async getCashTransactionsByRegisterId(registerId: string): Promise<CashTransaction[]> {
    try {
      console.log("Obteniendo transacciones de efectivo para caja:", registerId)

      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .eq("cash_register_id", registerId)
        .order("timestamp", { ascending: false })

      if (error) {
        console.error("Error al obtener transacciones de efectivo:", error)
        throw error
      }

      console.log("Transacciones de efectivo obtenidas:", data.length)

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getCashTransactionsByRegisterId:", error)
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
        console.error("Error al obtener transacciones por orden:", error)
        throw error
      }

      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id,
        waiterId: t.waiter_id,
        amount: t.amount,
        tipAmount: t.tip_amount,
        method: t.method,
        cashReceived: t.cash_received,
        cashChange: t.cash_change,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getTransactionsByOrderId:", error)
      throw error
    }
  },

  // Actualizar la función getTransactionsByDateRange para incluir waiterId y tipAmount
  async getTransactionsByDateRange(startDate: Date, endDate: Date): Promise<PaymentTransaction[]> {
    try {
      console.log("Obteniendo transacciones por rango de fechas:", startDate.toISOString(), "a", endDate.toISOString())

      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .gte("timestamp", startDate.toISOString())
        .lte("timestamp", endDate.toISOString())
        .order("timestamp", { ascending: false })

      if (error) {
        console.error("Error al obtener transacciones por rango de fechas:", error)
        throw error
      }

      console.log("Transacciones obtenidas:", data.length)

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        orderId: t.order_id,
        tableId: t.table_id,
        waiterId: t.waiter_id,
        amount: t.amount,
        tipAmount: t.tip_amount,
        method: t.method,
        cashReceived: t.cash_received,
        cashChange: t.cash_change,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getTransactionsByDateRange:", error)
      throw error
    }
  },

  async getCashTransactionsByDateRange(startDate: Date, endDate: Date): Promise<CashTransaction[]> {
    try {
      console.log(
        "Obteniendo transacciones de efectivo por rango de fechas:",
        startDate.toISOString(),
        "a",
        endDate.toISOString(),
      )

      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .gte("timestamp", startDate.toISOString())
        .lte("timestamp", endDate.toISOString())
        .order("timestamp", { ascending: false })

      if (error) {
        console.error("Error al obtener transacciones de efectivo por rango de fechas:", error)
        throw error
      }

      console.log("Transacciones de efectivo obtenidas:", data.length)

      // Convertir el formato de la base de datos al formato del store
      return data.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type,
        description: t.description,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getCashTransactionsByDateRange:", error)
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
        tableId: t.table_id,
        waiterId: t.waiter_id,
        amount: t.amount,
        tipAmount: t.tip_amount,
        method: t.method,
        cashReceived: t.cash_received,
        cashChange: t.cash_change,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getTransactionsByRegisters:", error)
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
        type: t.type,
        description: t.description,
        timestamp: new Date(t.timestamp),
        cash_register_id: t.cash_register_id,
      }))
    } catch (error) {
      console.error("Error en getCashTransactionsByRegisters:", error)
      throw error
    }
  },

  // Actualizar la función calculateRegisterSummary para incluir totalTips y cashTransactions
  calculateRegisterSummary(register: CashRegister): CashRegisterSummary {
    // Inicializar el resumen
    const summary: CashRegisterSummary = {
      initialCash: register.initialCash,
      totalCash: 0,
      totalTransfer: 0,
      totalNequi: 0,
      totalBancolombia: 0,
      totalSales: 0,
      totalTips: 0,
      totalChange: 0,
      totalCashDeposits: 0,
      totalCashWithdrawals: 0,
      finalCash: register.initialCash,
    }

    // Calcular totales por método de pago
    register.transactions.forEach((transaction) => {
      summary.totalSales += transaction.amount

      // Sumar propinas
      if (transaction.tipAmount) {
        summary.totalTips += transaction.tipAmount
      }

      switch (transaction.method) {
        case "cash":
          summary.totalCash += transaction.amount
          if (transaction.cashChange) {
            summary.totalChange += transaction.cashChange
          }
          break
        case "transfer":
          summary.totalTransfer += transaction.amount
          break
        case "nequi":
          summary.totalNequi += transaction.amount
          break
        case "bancolombia":
          summary.totalBancolombia += transaction.amount
          break
      }
    })

    // Calcular totales de transacciones de efectivo
    register.cashTransactions.forEach((transaction) => {
      if (transaction.type === "deposit") {
        summary.totalCashDeposits += transaction.amount
      } else if (transaction.type === "withdrawal") {
        summary.totalCashWithdrawals += transaction.amount
      }
    })

    // Calcular efectivo final
    summary.finalCash =
      summary.initialCash +
      summary.totalCash -
      summary.totalChange +
      summary.totalCashDeposits -
      summary.totalCashWithdrawals

    return summary
  },

  // Nuevo método para calcular el resumen de múltiples cajas
  calculateMultipleRegistersSummary(registers: CashRegister[]): CashRegisterSummary {
    // Inicializar el resumen
    const summary: CashRegisterSummary = {
      initialCash: 0,
      totalCash: 0,
      totalTransfer: 0,
      totalNequi: 0,
      totalBancolombia: 0,
      totalSales: 0,
      totalTips: 0,
      totalChange: 0,
      totalCashDeposits: 0,
      totalCashWithdrawals: 0,
      finalCash: 0,
      cashTransactions: [],
    }

    // Sumar los valores de todas las cajas
    registers.forEach((register) => {
      const registerSummary = this.calculateRegisterSummary(register)

      summary.initialCash += registerSummary.initialCash || 0
      summary.totalCash += registerSummary.totalCash || 0
      summary.totalTransfer += registerSummary.totalTransfer || 0
      summary.totalNequi += registerSummary.totalNequi || 0
      summary.totalBancolombia += registerSummary.totalBancolombia || 0
      summary.totalSales += registerSummary.totalSales || 0
      summary.totalTips += registerSummary.totalTips || 0
      summary.totalChange += registerSummary.totalChange || 0
      summary.totalCashDeposits += registerSummary.totalCashDeposits || 0
      summary.totalCashWithdrawals += registerSummary.totalCashWithdrawals || 0

      // Agregar todas las transacciones de efectivo
      if (register.cashTransactions) {
        summary.cashTransactions = [...(summary.cashTransactions || []), ...register.cashTransactions]
      }
    })

    // Calcular efectivo final
    summary.finalCash =
      summary.initialCash +
      summary.totalCash -
      summary.totalChange +
      summary.totalCashDeposits -
      summary.totalCashWithdrawals

    return summary
  },
  currentRegisterId: null,
}
