import { supabase } from '@/lib/supabase/client'
import type { Order, OrderCreate } from './types'
import { UnitOfWork } from '../unit-of-work'

export class OrderRepository extends UnitOfWork {
  async create(order: OrderCreate): Promise<Order> {
    const { data, error } = await supabase
      .from('orders')
      .insert({
        table_id: order.table_id,
        waiter_id: order.waiter_id,
        subtotal: order.subtotal,
        tax: order.tax,
        tax_percentage: order.tax_percentage,
        tip: order.tip,
        tip_percentage: order.tip_percentage,
        total: order.total,
        status: order.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) throw error
    return data as Order
  }

  async updateStatus(orderId: string, status: Order['status']): Promise<Order> {
    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select()
      .single()
    if (error) throw error
    return data as Order
  }

  async getById(orderId: string): Promise<Order | null> {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()
    if (error) throw error
    return data as Order
  }
}
