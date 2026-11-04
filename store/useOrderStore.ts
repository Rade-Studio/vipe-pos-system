import { create } from "zustand"
import type { Order } from "@/types"
import { getByStatus, toOrder } from "@/lib/api/orders"

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

  // ONE request for the three open statuses (it used to be three), mapped by
  // the shared `toOrder`. Orders the store already holds keep their identity.
  loadOrders: async () => {
    const dbOrders = await getByStatus(["kitchen", "delivered", "active"])
    const existingOrderIds = new Set(get().orders.map((order) => order.id))
    const newOrders = dbOrders.filter((dbOrder) => !existingOrderIds.has(dbOrder.id)).map(toOrder)

    if (newOrders.length > 0) {
      set((state) => ({
        orders: [...state.orders, ...newOrders],
      }))
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