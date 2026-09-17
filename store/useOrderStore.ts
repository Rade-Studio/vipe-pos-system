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
  completePayment: (orderId: string, paymentMethod?: string) => Promise<string>
  completePartialPayment: (orderId: string, selectedItems: string[]) => Promise<string>
  createPartialOrder: (orderId: string, selectedItems: { itemId: string; quantity: number }[]) => Promise<string>
  deletePartialOrder: (orderId: string) => Promise<void>
  undoPartialPayment: (orderId: string) => Promise<void>
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
            categoryId: item.category_id || "",
            originalPrice: item.original_price,
            discountAmount: item.discount_amount,
            discountPercentage: item.discount_percentage,
            promotionId: item.promotion_id,
            promotionName: item.promotion_name,
          }))

          return {
            id: dbOrder.id,
            tableId: dbOrder.table_id,
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
            waiter: dbOrder.waiter_id,
            createdAt: new Date(dbOrder.created_at),
            isPartialOrder: dbOrder.is_partial_order || false,
            parentOrderId: dbOrder.parent_order_id || null,
          } as Order
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

  completePayment: async (orderId, paymentMethod = "cash") => {
    const order = get().getOrderById(orderId)
    const invoiceNumber = await orderService.completePayment(orderId, paymentMethod)

    if (order) {
      set((state) => ({
        orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "paid" } : o)),
      }))

      const activeOrders = get()
        .getOrdersByTable(order.tableId)
        .filter(
          (o) =>
            o.id !== orderId &&
            (o.status === "kitchen" || o.status === "delivered" || o.status === "active"),
        )

      if (activeOrders.length === 0) {
        // Release the table via tableService (stateless, no store dependency)
        await tableService.releaseTable(order.tableId)
      }
    } else {
      try {
        const dbOrder = await orderService.getById(orderId)
        if (dbOrder && dbOrder.table_id) {
          const { data: activeOrders } = await supabase
            .from("orders")
            .select("id")
            .eq("table_id", dbOrder.table_id)
            .neq("id", orderId)
            .neq("status", "paid")

          if (!activeOrders || activeOrders.length === 0) {
            await tableService.releaseTable(dbOrder.table_id)
          }
        }
      } catch {
        // Swallow — do not interrupt flow
      }
    }

    return invoiceNumber
  },

  completePartialPayment: async (orderId, selectedItems) => {
    const invoiceNumber = await orderService.completePartialPayment(orderId, selectedItems)
    const order = get().getOrderById(orderId)
    if (order) {
      set((state) => ({
        orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: "paid" } : o)),
      }))
    }
    return invoiceNumber
  },

  createPartialOrder: async (orderId, selectedItems) => {
    const parentOrder = get().getOrderById(orderId)
    if (!parentOrder) throw new Error("Parent order not found")

    const partialItems = parentOrder.items
      .filter((item) => selectedItems.some((selected) => selected.itemId === item.id && selected.quantity > 0))
      .map((item) => {
        const selectedItem = selectedItems.find((selected) => selected.itemId === item.id)
        return {
          ...item,
          quantity: selectedItem ? selectedItem.quantity : item.quantity,
        }
      })

    // Calculate bill using cart store helper
    const subtotal = partialItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const taxPercentage = 8
    const tipPercentage = 10
    const tax = Math.round(subtotal * (taxPercentage / 100))
    const tip = Math.round(subtotal * (tipPercentage / 100))
    const total = subtotal + tax + tip
    const bill = { subtotal, tax, taxPercentage, tip, tipPercentage, total, totalDiscounts: 0 }

    const partialOrderData = await orderService.createPartialOrder(orderId, partialItems, bill)

    // Update original order items
    const updatedItems = parentOrder.items.filter(
      (item) => !partialItems.some((pi) => pi.id === item.id && pi.quantity === item.quantity),
    )
    const reducedItems = parentOrder.items
      .filter((item) => partialItems.some((pi) => pi.id === item.id && pi.quantity < item.quantity))
      .map((item) => {
        const partialItem = partialItems.find((pi) => pi.id === item.id)
        return {
          ...item,
          quantity: item.quantity - (partialItem?.quantity || 0),
        }
      })
    const remainingItems = [...updatedItems, ...reducedItems]
    const remainingSubtotal = remainingItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const remainingTax = Math.round(remainingSubtotal * (taxPercentage / 100))
    const remainingTip = Math.round(remainingSubtotal * (tipPercentage / 100))
    const remainingTotal = remainingSubtotal + remainingTax + remainingTip
    const updatedBill = {
      subtotal: remainingSubtotal,
      tax: remainingTax,
      taxPercentage,
      tip: remainingTip,
      tipPercentage,
      total: remainingTotal,
      totalDiscounts: 0,
    }

    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === orderId ? { ...o, items: remainingItems, bill: updatedBill } : o,
      ),
    }))

    const newPartialOrder: Order = {
      id: partialOrderData.id,
      tableId: parentOrder.tableId,
      items: partialItems,
      status: "active",
      bill,
      waiter: parentOrder.waiter,
      createdAt: new Date(),
      isPartialOrder: true,
      parentOrderId: orderId,
    }

    set((state) => ({
      orders: [...state.orders, newPartialOrder],
    }))

    return partialOrderData.id
  },

  deletePartialOrder: async (orderId) => {
    await orderService.deletePartialOrder(orderId)

    const partialOrder = get().getOrderById(orderId)
    if (!partialOrder || !partialOrder.isPartialOrder || !partialOrder.parentOrderId) {
      throw new Error("Invalid partial order")
    }

    const parentOrder = get().getOrderById(partialOrder.parentOrderId)
    if (!parentOrder) throw new Error("Parent order not found")

    const updatedItems = [...parentOrder.items]
    partialOrder.items.forEach((partialItem) => {
      const existingItemIndex = updatedItems.findIndex(
        (item) => item.name === partialItem.name && item.comments === partialItem.comments,
      )
      if (existingItemIndex !== -1) {
        updatedItems[existingItemIndex] = {
          ...updatedItems[existingItemIndex],
          quantity: updatedItems[existingItemIndex].quantity + partialItem.quantity,
        }
      } else {
        updatedItems.push(partialItem)
      }
    })

    const subtotal = updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const taxPercentage = 8
    const tipPercentage = 10
    const tax = Math.round(subtotal * (taxPercentage / 100))
    const tip = Math.round(subtotal * (tipPercentage / 100))
    const total = subtotal + tax + tip
    const updatedBill = { subtotal, tax, taxPercentage, tip, tipPercentage, total, totalDiscounts: 0 }

    set((state) => ({
      orders: state.orders.map((o) =>
        o.id === parentOrder.id ? { ...o, items: updatedItems, bill: updatedBill } : o,
      ),
    }))

    set((state) => ({
      orders: state.orders.filter((order) => order.id !== orderId),
    }))
  },

  undoPartialPayment: async (orderId) => {
    const partialOrder = get().getOrderById(orderId)
    if (!partialOrder || !partialOrder.isPartialOrder || !partialOrder.parentOrderId) {
      throw new Error("Invalid partial order")
    }
    await get().deletePartialOrder(orderId)
  },
}))
