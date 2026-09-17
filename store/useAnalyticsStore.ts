import { create } from "zustand"
import type { Order } from "@/types"

interface AnalyticsState {
  getTotalSales: (orders: Order[]) => number
  getCompletedOrdersCount: (orders: Order[]) => number
  getAverageOrderValue: (orders: Order[]) => number
  getDailySales: (orders: Order[], days: number) => { date: string; amount: number }[]
  getPopularDishes: (orders: Order[], limit: number) => { name: string; count: number }[]
  getCategorySales: (orders: Order[]) => { category: string; amount: number }[]
}

export const useAnalyticsStore = create<AnalyticsState>(() => ({
  getTotalSales: (orders) => {
    return orders
      .filter((order) => order.status === "paid")
      .reduce((total, order) => total + order.bill.total, 0)
  },

  getCompletedOrdersCount: (orders) => {
    return orders.filter((order) => order.status === "paid").length
  },

  getAverageOrderValue: (orders) => {
    const completedOrders = orders.filter((order) => order.status === "paid")
    if (completedOrders.length === 0) return 0
    return useAnalyticsStore.getState().getTotalSales(completedOrders) / completedOrders.length
  },

  getDailySales: (orders, days) => {
    const result = []
    const today = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() - i)
      const dateStr = date.toISOString().split("T")[0]

      const amount = orders
        .filter(
          (order) =>
            order.status === "paid" && order.createdAt.toISOString().split("T")[0] === dateStr,
        )
        .reduce((sum, order) => sum + order.bill.total, 0)

      result.push({ date: dateStr, amount })
    }

    return result
  },

  getPopularDishes: (orders, limit) => {
    const dishCounts: Record<string, number> = {}

    orders
      .filter((order) => order.status === "paid")
      .forEach((order) => {
        order.items.forEach((item) => {
          if (!dishCounts[item.name]) {
            dishCounts[item.name] = 0
          }
          dishCounts[item.name] += item.quantity
        })
      })

    return Object.entries(dishCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  },

  getCategorySales: (orders) => {
    const categorySales: Record<string, number> = {}

    orders
      .filter((order) => order.status === "paid")
      .forEach((order) => {
        order.items.forEach((item) => {
          if (!categorySales[item.categoryId]) {
            categorySales[item.categoryId] = 0
          }
          categorySales[item.categoryId] += item.price * item.quantity
        })
      })

    return Object.entries(categorySales).map(([category, amount]) => ({ category, amount }))
  },
}))
