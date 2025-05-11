import type { JSX } from "react"

// Profile types
export type ProfileRole = "waiter" | "kitchen" | "cashier" | "admin"

export type Profile = {
  id: string
  name: string
  role: ProfileRole
  hasPassword: boolean
}

// Table types
export type TableStatus = "available" | "reserved" | "occupied" | "kitchen" | "delivered"

export type Table = {
  id: string
  number: number
  status: TableStatus
  waiter?: string
}

// Order types
export type OrderStatus = "active" | "cancelled" | "paid"
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
}

export type CashRegisterStatus = "closed" | "open"

export type CashRegister = {
  id: string
  openingTimestamp: Date
  closingTimestamp?: Date
  initialCash: number
  status: CashRegisterStatus
  transactions: PaymentTransaction[]
}

// Summary types for cash register
export type CashRegisterSummary = {
  initialCash: number
  totalCash: number
  totalTransfer: number
  totalNequi: number
  totalBancolombia: number
  totalSales: number
  totalChange: number
  finalCash: number
}

// Tipos para impresión
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
  paymentMethod: string
  cashReceived?: number
  cashChange?: number
}

export type PrintableKitchenOrder = {
  orderNumber: string
  date: Date
  table: number
  waiter: string
  items: CartItem[]
}
