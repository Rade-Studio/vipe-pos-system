export type OrderStatus =
  | 'pending'
  | 'kitchen'
  | 'delivered'
  | 'active'
  | 'paid';

export interface OrderCreate {
  table_id: string
  waiter_id: string
  items: any[]
  subtotal: number
  tax: number
  tax_percentage: number
  tip: number
  tip_percentage: number
  total: number
  status: OrderStatus
}

export interface Order {
  id: string
  table_id: string
  waiter_id: string
  status: OrderStatus
  subtotal: number
  tax: number
  tax_percentage: number
  tip: number
  tip_percentage: number
  total: number
}
