import { create } from "zustand"
import { v4 as uuidv4 } from "uuid"
import type { Order } from "@/types"
import { supabase, tableService, orderService } from "@/lib/supabase"

interface OrderState {
  orders: Order[]
  addOrder: (order: Order) => void
  updateOrder: (orderId: string, updatedOrder: Order) => void
  removeOrder: (orderId: string) => void
  updateOrderStatus: (orderId: string, status: Order["status"]) => void
  getOrdersByStatus: (statuses: Order["status"][]) => Order[]
  getOrdersByTable: (tableId: string) => Order[]
  setOrders: (orders: Order[]) => void
  loadOrders: () => Promise<void>
  getOrderById: (orderId: string) => Order | undefined
  getTableTotalAmount: (tableId: string) => number
}

export const useOrderStore = create<OrderState>((set, get) => ({
  orders: [],

  addOrder: (order) => {
    set((state) => {
      const exists = state.orders.some((o) => o.id === order.id)
      if (exists) return state
      return { orders: [...state.orders, order] }
    })
  },

  updateOrder: (orderId, updatedOrder) => {
    set((state) => ({
      orders: state.orders.map((order) => (order.id === orderId ? { ...updatedOrder } : order)),
    }))
  },

  removeOrder: (orderId) => {
    set((state) => ({
      orders: state.orders.filter((order) => order.id !== orderId),
    }))
  },

  updateOrderStatus: (orderId, status) =>
    set((state) => ({
      orders: state.orders.map((order) => (order.id === orderId ? { ...order, status } : order)),
    })),

  getOrdersByStatus: (statuses) => {
    return get().orders.filter((order) => statuses.includes(order.status))
  },

  getOrdersByTable: (tableId) => {
    return get().orders.filter((order) => order.tableId === tableId)
  },

  setOrders: (orders) => set({ orders }),

  loadOrders: async () => {
    try {
      const kitchenOrders = await orderService.getByStatus(["kitchen"])
      const deliveredOrders = await orderService.getByStatus(["delivered"])
      const activeOrders = await orderService.getByStatus(["active"])

      const dbOrders = [...kitchenOrders, ...deliveredOrders, ...activeOrders]
      const existingOrderIds = get().orders.map((order) => order.id)
      const newOrders = dbOrders.filter((dbOrder) => !existingOrderIds.includes(dbOrder.id))

      if (newOrders.length > 0) {
        const storeOrders = newOrders.map((dbOrder) => {
          const items = dbOrder.order_items.map((item) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            comments: item.comments || undefined,
            categoryId: "",
          }))

          return {
            id: dbOrder.id,
            tableId: dbOrder.table_id || "",
            items,
            status: dbOrder.status,
            bill: {
              subtotal: dbOrder.subtotal,
              tax: dbOrder.tax,
              taxPercentage: dbOrder.tax_percentage,
              tip: dbOrder.tip,
              tipPercentage: dbOrder.tip_percentage,
              total: dbOrder.total,
              totalDiscounts: dbOrder.total_discounts || 0,
            },
            waiter: dbOrder.waiter_id || "",
            createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
            isPartialOrder: dbOrder.is_partial_order || false,
            parentOrderId: dbOrder.parent_order_id || undefined,
          } as unknown as Order
        })

        set((state) => ({
          orders: [...state.orders, ...storeOrders],
        }))
      }
    } catch (err) {
      throw err
    }
  },

  getOrderById: (orderId) => {
    return get().orders.find((order) => order.id === orderId)
  },

  getTableTotalAmount: (tableId) => {
    const orders = get().getOrdersByTable(tableId)
    return orders.reduce((total, order) => total + order.bill.total, 0)
  },
}))