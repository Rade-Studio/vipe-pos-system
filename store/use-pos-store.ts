/**
 * Thin shim re-exporting five focused stores under the old usePOSStore interface.
 * All callers continue to work during the P6 migration window.
 * DELETE in PR #6c once all imports are migrated to individual stores.
 */
import { create } from "zustand"
import type { Table, CartItem, Order, Profile, Category, Dish, OrderBill } from "@/types"
import { useTableStore } from "./useTableStore"
import { useCartStore } from "./useCartStore"
import { useOrderStore } from "./useOrderStore"
import { useMenuStore } from "./useMenuStore"
import { useAnalyticsStore } from "./useAnalyticsStore"

export type { Table, CartItem, Order, Profile }

type TableId = string
type WaiterId = string
type OrderId = string
type ItemId = string

interface POSState {
  // Table domain
  tables: Table[]
  activeTable: string | null
  setTables: (tables: Table[]) => void
  setActiveTable: (tableId: string | null) => void
  updateTable: (tableId: string, updates: Partial<Table>) => void
  reserveTable: (tableId: string, waiterId: string) => void
  releaseTable: (tableId: string) => void
  updateTableStatus: (tableId: string, status: Table["status"]) => void
  isTableAccessibleByWaiter: (tableId: string, waiterId: string) => boolean
  assignWaiterToTable: (tableId: string, waiterId: string) => void
  getTableWaiter: (tableId: string) => string | undefined
  getTableById: (tableId: string) => Table | undefined

  // Cart domain
  cartItems: Record<string, CartItem[]>
  addToCart: (tableId: string, item: CartItem) => void
  updateQuantity: (tableId: string, itemId: string, quantity: number) => void
  updateItemComments: (tableId: string, itemId: string, comments: string) => void
  removeFromCart: (tableId: string, itemId: string) => void
  clearCart: (tableId: string) => void
  getCartByTable: (tableId: string) => CartItem[]
  getCartTotal: (tableId: string) => number
  calculateOrderBill: (items: CartItem[], tipPercentage?: number, taxPercentage?: number) => OrderBill

  // Order domain
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
  completePayment: (orderId: string, paymentMethod?: string) => Promise<string>
  completePartialPayment: (orderId: string, selectedItems: string[]) => Promise<string>
  createPartialOrder: (orderId: string, selectedItems: { itemId: string; quantity: number }[]) => Promise<string>
  deletePartialOrder: (orderId: string) => Promise<void>
  undoPartialPayment: (orderId: string) => Promise<void>
  getTableTotalAmount: (tableId: string) => number

  // Analytics
  getTotalSales: () => number
  getCompletedOrdersCount: () => number
  getAverageOrderValue: () => number
  getDailySales: (days: number) => { date: string; amount: number }[]
  getPopularDishes: (limit: number) => { name: string; count: number }[]
  getCategorySales: () => { category: string; amount: number }[]

  // Profiles (stub — each view manages its own profile list locally)
  profiles: Profile[]
  setProfiles: (profiles: Profile[]) => void

  // Menu domain
  categories: Category[]
  dishes: Dish[]
  setCategories: (categories: Category[]) => void
  setDishes: (dishes: Dish[]) => void
}

export const usePOSStore = create<POSState>((set, get) => ({
  // ── Table domain (delegated to useTableStore) ──────────────────────────────
  get tables() { return useTableStore.getState().tables },
  get activeTable() { return useTableStore.getState().activeTable },

  setTables: (tables) => useTableStore.getState().setTables(tables),
  setActiveTable: (tableId) => useTableStore.setState({ activeTable: tableId }),
  updateTable: (tableId, updates) =>
    useTableStore.setState((state) => ({
      tables: state.tables.map((t) => (t.id === tableId ? { ...t, ...updates } : t)),
    })),
  reserveTable: (tableId, waiterId) =>
    useTableStore.getState().reserveTable(tableId, waiterId),
  releaseTable: (tableId) =>
    useTableStore.getState().releaseTable(tableId),
  updateTableStatus: (tableId, status) =>
    useTableStore.getState().updateTableStatus(tableId, status),
  isTableAccessibleByWaiter: (tableId, waiterId) =>
    useTableStore.getState().isTableAccessibleByWaiter(tableId, waiterId),
  assignWaiterToTable: (tableId, waiterId) =>
    useTableStore.getState().assignWaiterToTable(tableId, waiterId),
  getTableWaiter: (tableId) => useTableStore.getState().getTableWaiter(tableId),
  getTableById: (tableId) => useTableStore.getState().getTableById(tableId),

  // ── Cart domain (delegated to useCartStore) ────────────────────────────────
  get cartItems() { return useCartStore.getState().cartItems },

  addToCart: (tableId, item) => useCartStore.getState().addToCart(tableId, item),
  updateQuantity: (tableId, itemId, quantity) =>
    useCartStore.getState().updateQuantity(tableId, itemId, quantity),
  updateItemComments: (tableId, itemId, comments) =>
    useCartStore.getState().updateItemComments(tableId, itemId, comments),
  removeFromCart: (tableId, itemId) =>
    useCartStore.getState().removeFromCart(tableId, itemId),
  clearCart: (tableId) => useCartStore.getState().clearCart(tableId),
  getCartByTable: (tableId) => useCartStore.getState().getCartByTable(tableId),
  getCartTotal: (tableId) => useCartStore.getState().getCartTotal(tableId),
  calculateOrderBill: (items, tipPct = 10, taxPct = 8) => {
    const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
    const tax = Math.round(subtotal * (taxPct / 100))
    const tip = Math.round(subtotal * (tipPct / 100))
    const totalDiscounts = items.reduce((s, i) => {
      if (i.originalPrice && i.originalPrice > i.price) {
        return s + (i.originalPrice - i.price) * i.quantity
      }
      return s
    }, 0)
    return { subtotal, tax, taxPercentage: taxPct, tip, tipPercentage: tipPct, total: subtotal + tax + tip, totalDiscounts }
  },

  // ── Order domain (delegated to useOrderStore) ─────────────────────────────
  get orders() { return useOrderStore.getState().orders },

  addOrder: (order) => {
    const exists = useOrderStore.getState().orders.some((o) => o.id === order.id)
    if (!exists) useOrderStore.setState((state) => ({ orders: [...state.orders, order] }))
  },
  updateOrder: (orderId, updatedOrder) =>
    useOrderStore.setState((state) => ({
      orders: state.orders.map((o) => (o.id === orderId ? { ...updatedOrder } : o)),
    })),
  removeOrder: (orderId) =>
    useOrderStore.setState((state) => ({ orders: state.orders.filter((o) => o.id !== orderId) })),
  updateOrderStatus: (orderId, status) =>
    useOrderStore.setState((state) => ({
      orders: state.orders.map((o) => (o.id === orderId ? { ...o, status } : o)),
    })),
  getOrdersByStatus: (statuses) => useOrderStore.getState().getOrdersByStatus(statuses),
  getOrdersByTable: (tableId) => useOrderStore.getState().getOrdersByTable(tableId),
  setOrders: (orders) => useOrderStore.setState({ orders }),
  loadOrders: () => useOrderStore.getState().loadOrders(),
  getOrderById: (orderId) => useOrderStore.getState().getOrderById(orderId),
  completePayment: (orderId, paymentMethod) =>
    useOrderStore.getState().completePayment(orderId, paymentMethod),
  completePartialPayment: (orderId, selectedItems) =>
    useOrderStore.getState().completePartialPayment(orderId, selectedItems),
  createPartialOrder: (orderId, selectedItems) =>
    useOrderStore.getState().createPartialOrder(orderId, selectedItems),
  deletePartialOrder: (orderId) => useOrderStore.getState().deletePartialOrder(orderId),
  undoPartialPayment: (orderId) => useOrderStore.getState().undoPartialPayment(orderId),
  getTableTotalAmount: (tableId) => useOrderStore.getState().getTableTotalAmount(tableId),

  // ── Analytics (delegated to useAnalyticsStore) ─────────────────────────────
  getTotalSales: () => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getTotalSales(orders)
  },
  getCompletedOrdersCount: () => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getCompletedOrdersCount(orders)
  },
  getAverageOrderValue: () => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getAverageOrderValue(orders)
  },
  getDailySales: (days) => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getDailySales(orders, days)
  },
  getPopularDishes: (limit) => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getPopularDishes(orders, limit)
  },
  getCategorySales: () => {
    const orders = useOrderStore.getState().orders
    return useAnalyticsStore.getState().getCategorySales(orders)
  },

  // ── Profiles (stub — each view manages its own profile list locally) ─────
  profiles: [],
  setProfiles: (profiles) => set({ profiles }),

  // ── Menu domain (delegated to useMenuStore) ───────────────────────────────
  get categories() { return useMenuStore.getState().categories },
  get dishes() { return useMenuStore.getState().dishes },
  setCategories: (categories) => useMenuStore.setState({ categories }),
  setDishes: (dishes) => useMenuStore.setState({ dishes }),
}))
