export type PaymentMethod = "cash" | "transfer" | "nequi" | "bancolombia"

export type PaymentTransaction = {
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

export type CashTransaction = {
  id: string
  amount: number
  type: "deposit" | "withdrawal"
  description: string
  timestamp: Date
  cash_register_id: string
}

export type CashRegister = {
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

export type CashRegisterSummary = {
  initialCash: number
  totalCash: number
  totalTransfer: number
  totalNequi: number
  totalBancolombia: number
  totalSales: number
  totalTips: number
  totalChange: number
  totalCashDeposits: number
  totalCashWithdrawals: number
  finalCash: number
}
