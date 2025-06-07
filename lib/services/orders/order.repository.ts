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

  async getByStatus(statuses: Order['status'][]): Promise<any[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .in('status', statuses)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  }

  async addItemsToOrder(orderId: string, items: any[]) {
    const { data, error } = await supabase
      .from('order_items')
      .insert(items)
      .select()
    if (error) throw error
    return data
  }

  async recalculateOrderTotals(orderId: string) {
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)
    if (itemsError) throw itemsError
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()
    if (orderError) throw orderError
    const subtotal = (items || []).reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    )
    const tax = Math.round(subtotal * (order.tax_percentage / 100))
    const tip = Math.round(subtotal * (order.tip_percentage / 100))
    const total = subtotal + tax + tip
    const { error: updateError } = await supabase
      .from('orders')
      .update({ subtotal, tax, tip, total, updated_at: new Date().toISOString() })
      .eq('id', orderId)
    if (updateError) throw updateError
  }

  async deleteOrder(orderId: string) {
    await supabase.from('order_items').delete().eq('order_id', orderId)
    const { error } = await supabase.from('orders').delete().eq('id', orderId)
    if (error) throw error
    return true
  }

  async createPartialOrder(parentOrderId: string, items: any[], bill: any) {
    const { data: parent, error: parentError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', parentOrderId)
      .single()
    if (parentError) throw parentError
    const { data: partial, error } = await supabase
      .from('orders')
      .insert({
        table_id: parent.table_id,
        waiter_id: parent.waiter_id,
        subtotal: bill.subtotal,
        tax: bill.tax,
        tax_percentage: bill.taxPercentage,
        tip: bill.tip,
        tip_percentage: bill.tipPercentage,
        total: bill.total,
        status: 'active',
        is_partial_order: true,
        parent_order_id: parentOrderId
      })
      .select()
      .single()
    if (error) throw error
    const orderItems = items.map((it) => ({
      order_id: partial.id,
      dish_id: it.id,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
      comments: it.comments || null
    }))
    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)
    if (itemsError) throw itemsError
    return partial
  }

  async deletePartialOrder(orderId: string) {
    await supabase.from('order_items').delete().eq('order_id', orderId)
    const { error } = await supabase.from('orders').delete().eq('id', orderId)
    if (error) throw error
    return true
  }

  async getDetailedByStatus(statuses: Order['status'][]): Promise<any[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*), tables(number), profiles(full_name)')
      .in('status', statuses)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  }

  async updateItemStatus(itemId: string, status: string) {
    const { error } = await supabase
      .from('order_items')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) throw error
  }

  async updateItemsStatus(itemIds: string[], status: string) {
    const { error } = await supabase
      .from('order_items')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', itemIds)
    if (error) throw error
  }

  async deleteItem(itemId: string) {
    const { error } = await supabase.from('order_items').delete().eq('id', itemId)
    if (error) throw error
  }

  async deletePendingItems(orderId: string) {
    const { error } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId)
      .eq('status', 'pending')
    if (error) throw error
  }
}
