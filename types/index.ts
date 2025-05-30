import type { JSX } from "react"
import { Database } from "./supabase.types"

// Profile types
export type ProfileRole = "waiter" | "kitchen" | "cashier" | "admin"

export type Profile = {
  id: string
  name: string
  full_name: string
  role: ProfileRole
  hasPassword: boolean
}

// Table types
export type TableStatus = "available" | "reserved" | "occupied" | "kitchen" | "delivered" | "served"

export type Table = {
  id: string
  number: number
  status: TableStatus
  waiter_id?: string
  profile?: Profile
}

// Order types
export type OrderStatus = "active" | "cancelled" | "paid" | "kitchen" | "delivered" | "served"
export type OrderItemStatus = "kitchen" | "served"

export type OrderBill = {
  subtotal?: number
  tax?: number
  taxPercentage?: number
  tip?: number
  tipPercentage?: number
  total?: number
  totalDiscounts?: number
}

export type OrderItem = {
  id: string
  name: string
  price: number
  quantity: number
  categoryId: string
  dish_id?: string
  image: string
  comments?: string
  status: OrderItemStatus
  original_price?: number
  discount_amount?: number
  discount_percentage?: number
  promotion_id?: string
  promotion_name?: string
  created_at?: string
  added_at?: string
  dish?: Dish
}

export type Order = {
  id: string
  table_id?: string
  order_items: OrderItem[]
  items_json?: JSON
  status: OrderStatus
  bill?: OrderBill
  waiter_id: string
  created_at: Date
  is_partial_order?: boolean
  parent_order_id?: string
}

export type OrderByStatusWithAllData = {
  id: string
  table_id: string;
  order_items: OrderItem[]
  is_partial_order: boolean
  items_json: JSON
  parent_order_id?: string
  profile: {
    full_name: string
  }
  table: {
    number: string
  }
  status: OrderStatus
  subtotal: number
  tax: number
  tax_percentage: number
  tip: number
  tip_percentage: number
  total: number
  total_discounts: number
  updated_at: string
  created_at: string;
  waiter_id: string
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
  active: boolean
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

export type BusinessConfigValues = {
  tax_percentage: number
  tip_percentage: number
  price_suggestion: number
  business_name: string
  business_address: string
  business_phone: string
  business_nit: string
  inventory_control_enabled: boolean
  // Añadimos las contraseñas de los perfiles
  kitchen_password: string
  cashier_password: string
  admin_password: string
  waiter_password: string
  [key: string]: string | number | boolean
}

export type BusinessConfig = {
  id: string
  key: string
  value: string
  created_at?: string
  updated_at?: string
}

export type Promotion = {
  id: string
  name: string
  description: string | null
  discount_type: "percentage" | "fixed_amount"
  discount_value: number
  start_date: string
  end_date: string
  active: boolean
  created_at?: string
  updated_at?: string
  promotion_dishes?: { // Para las relaciones con platos
    dish_id: string;
    dishes?: {
      name: string;
    };
  }[];
}

export type IngredientCategory = { // Nuevo tipo para la categoría de ingrediente
  id: string;
  name: string;
  created_at?: string;
}

export interface Ingredient {
  id: string
  name: string
  description?: string
  unit: string
  stock: number
  min_stock: number
  cost?: number
  category_id?: string
  created_at?: string
  ingredient_categories?: { // Relación para la categoría
    id: string;
    name: string;
  }
  category?: string;
}

export type IngredientTransaction = {
  id: string // Cambiado a string
  ingredient_id: string // Usar ingredient_id
  quantity: number
  type: "purchase" | "adjustment" | "usage" | "waste" | "return" // Añadido "return"
  new_stock: number; // Nuevo campo para el stock después de la transacción
  reason: string; // Renombrado de notes a reason para más claridad
  responsible_user_id: string; // Nuevo campo para el usuario que realizó la transacción
  created_at: string // Usar created_at
  ingredient?: { // Relación para el ingrediente
    name: string;
    unit: string;
  }
  ingredient_name?: string; // Para el nombre del ingrediente en el frontend
  ingredient_unit?: string; // Para la unidad del ingrediente en el frontend
}

export type Recipe = {
  id: string // Cambiado a string
  dish_id: string // Usar dish_id
  created_at?: string // Añadido created_at para la tabla de recetas
}

export type RecipeIngredient = { // Nueva interfaz para la tabla intermedia
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  created_at?: string;
  ingredients?: { // Relación con ingrediente
    name: string;
    unit: string;
  }
  ingredient?: { // Para el objeto de ingrediente completo en el frontend
    name: string;
    unit: string;
  }
}

