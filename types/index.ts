import type { JSX } from "react"
import { APP_ROLES } from "@/lib/auth/roles"

// ============================================
// Restaurant (tenant root entity)
// ============================================
export interface Restaurant {
  id: string
  slug: string
  name: string
  timezone: string
  currency: string
  created_at: Date
  updated_at: Date
}

// ============================================
// Profile types
// `profiles.role` is a varchar in the DB; the canonical list lives in
// `lib/auth/roles.ts` and we derive this type from it so adding a role
// there is enough to make it available everywhere.
export type ProfileRole = (typeof APP_ROLES)[number]

export type Profile = {
  id: string
  name: string
  full_name?: string
  username?: string | null
  role: ProfileRole
  hasPassword: boolean
  restaurantId?: string
}

// Table types
export type TableStatus = "available" | "reserved" | "occupied" | "kitchen" | "served"

export type Table = {
  id: string
  number: number
  status: TableStatus
  waiter?: string
  waiter_name?: string
  updated_at?: Date
  restaurantId?: string
}

// Order types
export type OrderStatus = "active" | "cancelled" | "paid" | "delivered" | "kitchen"
export type OrderItemStatus = "kitchen" | "served"

export type OrderBill = {
  subtotal: number
  tax: number
  taxPercentage: number
  tip: number
  tipPercentage: number
  total: number
  // Nuevo campo para descuentos
  totalDiscounts: number
}

export type OrderItem = {
  id: string
  name: string
  price: number
  quantity: number
  categoryId: string
  image: string
  comments?: string
  status: OrderItemStatus
  addedAt?: Date
}

export type Order = {
  id: string
  tableId: string
  items: OrderItem[]
  status: OrderStatus
  bill: OrderBill
  waiter: string
  createdAt: Date
  isPartialOrder?: boolean
  parentOrderId?: string
  paymentMethod?: PaymentMethod | "multiple"
  restaurantId?: string
  /**
   * Ledger payment row attached by `getOrdersByDate` so the admin
   * reprint can build a tender list without a second round-trip.
   * Lives here (and not in `lib/supabase/service.ts`) so every
   * consumer that reads `Order` from the store gets the same shape.
   */
  ledgerPayment?: import("@/lib/payments/payment-list").PaymentRow
}

// Cart types
export type CartItem = {
  id: string
  name: string
  price: number
  quantity: number
  categoryId: string
  image: string
  comments?: string
  // Nuevos campos para descuentos
  originalPrice?: number
  discountAmount?: number
  discountPercentage?: number
  promotionId?: string
  promotionName?: string
}

// Category and dish types
export type Category = {
  id: string
  name: string
  icon: JSX.Element
}

export type Dish = {
  id: string
  name: string
  price: number
  categoryId: string
  image: string
  available?: boolean
  discountPercentage: number | null
  discountAmount: number | null
  originalPrice: number
  promotionName: string
}

// Summary types for analytics
export interface DailySales {
  date: string
  amount: number
}

export interface PopularDish {
  id?: string | null
  name: string
  count: number
}

export interface CategorySales {
  category: string
  amount: number
}

// Cash register types
export type PaymentMethod = "cash" | "transfer" | "nequi" | "bancolombia"

export type PaymentTransaction = {
  id: string
  orderId: string
  tableId: string
  amount: number
  method: PaymentMethod
  cashReceived?: number
  cashChange?: number
  timestamp: Date
  restaurantId?: string
}

export type CashRegisterStatus = "closed" | "open"

export type CashRegister = {
  id: string
  openingTimestamp: Date
  closingTimestamp?: Date
  initialCash: number
  status: CashRegisterStatus
  transactions: PaymentTransaction[]
  restaurantId?: string
}

// Summary types for cash register
// (CashRegisterSummary removed in task 8c: the only authority is the
// server's `register_summary` RPC; see `lib/payments/register-summary.ts`.)

// Tipos para impresión

/**
 * One row of the printable invoice's payment block. Re-exported
 * here so `PrintableInvoice.tenders` does not force every consumer
 * to import from `lib/payments`. The shape is owned by
 * `lib/payments/invoice-tenders.ts`.
 */
export type InvoiceTender = import("@/lib/payments/invoice-tenders").InvoiceTender

export interface PrintableInvoice {
  invoiceNumber: string
  date: Date
  businessInfo: {
    name: string
    address: string
    phone: string
    nit: string
  }
  items: CartItem[]
  bill: {
    subtotal: number
    tax: number
    taxPercentage: number
    tip: number
    tipPercentage: number
    total: number
    totalDiscounts: number // Nuevo campo
  }
  waiter: string
  table: string | number
  paymentMethod: PaymentMethod | "multiple"
  multiplePayments?: Record<PaymentMethod, boolean> | undefined
  cashReceived?: number
  cashChange?: number
  /**
   * Tender lines for the multi-method print path. When present, the
   * on-screen view and the hidden ticket render one block per line
   * (name + amount, plus "Recibido" / "Cambio" for cash lines). The
   * legacy single-label block (`paymentMethod` / `cashReceived` /
   * `cashChange`) is still populated so old Python listeners keep
   * working — see `lib/payments/invoice-tenders.legacyInvoiceFields`.
   */
  tenders?: InvoiceTender[]
  /**
   * Total change across every cash line. Mirrors `cashChange` but
   * is the value the new Python listener reads (the old field is
   * left alone for compatibility).
   */
  change?: number
}

export type PrintableKitchenOrder = {
  orderNumber: string
  date: Date
  table: number
  waiter: string
  items: CartItem[]
}

export type CommandPayload = {
  invoiceNumber: string;
  items: any[];
  waiter: string;
  table: number;
}

export type IngredientTransactionsOrders = {
  ingredient_transaction_id: string
  order_id: string
}
