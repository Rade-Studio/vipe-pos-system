export type PaymentMethod = "cash" | "transfer" | "nequi" | "bancolombia"

export interface PaymentTransaction {
  id: string
  orderId: string
  tableId: string
  waiterId?: string
  amount: number
  tipAmount?: number
  method: PaymentMethod
  cashReceived?: number
  cashChange?: number
  timestamp: Date
  cash_register_id: string
}

export interface CashTransaction {
  id: string
  amount: number
  type: "deposit" | "withdrawal"
  description: string
  timestamp: Date
  cash_register_id: string
}

export interface SupabaseTransaction {
  id: string
  order_id: string
  table_id: string
  waiter_id?: string
  amount: number
  tip_amount?: number
  method: PaymentMethod
  cash_received?: number
  cash_change?: number
  timestamp: string
  cash_register_id: string
}

export interface CashRegister {
  id: string
  openingTimestamp: Date
  closingTimestamp?: Date
  initialCash: number
  finalCash?: number
  status: "open" | "closed"
  transactions: PaymentTransaction[]
  cashTransactions: CashTransaction[]
  created_at?: Date
  updated_at?: Date
}

// Legacy `CashRegisterSummary` type removed in task 8c: the only authority on
// totals, tips, expected cash and the legacy block is the server's
// `register_summary` RPC (see `lib/payments/register-summary.ts`). The
// browser never recomputes any of those numbers any more.
