import { supabase } from "@/lib/db/client"
import type { DailySales, PopularDish, CategorySales } from "@/types"

export const dashboardService = {
  /**
   * Obtiene las ventas diarias para un período específico
   * @param days Número de días a consultar (por defecto 30)
   */
  async getDailySales(days = 30): Promise<DailySales[]> {
    try {
      // Calcular la fecha de inicio (hace X días)
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)
      startDate.setHours(0, 0, 0, 0)

      // Consulta para obtener las ventas agrupadas por día
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, total")
        .eq("status", "paid")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: true })

      if (error) throw error

      // Agrupar ventas por día
      const salesByDay = new Map<string, number>()

      data.forEach((order) => {
        const date = new Date(order.created_at).toISOString().split("T")[0]
        const currentTotal = salesByDay.get(date) || 0
        salesByDay.set(date, currentTotal + (order.total || 0))
      })

      // Convertir a array de DailySales
      return Array.from(salesByDay.entries()).map(([date, amount]) => ({
        date: date,
        amount: amount,
      }))
    } catch (error) {
      console.error("Error al obtener ventas diarias:", error)
      return []
    }
  },

  /**
   * Obtiene los platos más populares basados en la cantidad vendida
   * @param limit Número máximo de platos a retornar (por defecto 10)
   */
  async getPopularDishes(limit = 10): Promise<PopularDish[]> {
    try {
      // Consulta para obtener los items de órdenes pagadas
      const { data: orderItems, error: itemsError } = await supabase
        .from("order_items")
        .select(`
          name,
          dish_id,
          quantity,
          orders!inner(status)
        `)
        .eq("orders.status", "paid")

      if (itemsError) throw itemsError

      // Agrupar por plato y sumar cantidades
      const dishCounts = new Map<string, { id: string | null; name: string; count: number }>()

      orderItems.forEach((item) => {
        const key = item.name
        const current = dishCounts.get(key) || { id: item.dish_id, name: key, count: 0 }
        dishCounts.set(key, {
          ...current,
          count: current.count + item.quantity,
        })
      })

      // Convertir a array, ordenar y limitar
      return Array.from(dishCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
    } catch (error) {
      console.error("Error al obtener platos populares:", error)
      return []
    }
  },

  /**
   * Obtiene estadísticas generales del dashboard
   */
  async getDashboardStats() {
    try {
      // Obtener el primer día del mes actual
      const today = new Date()
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

      // Obtener órdenes del mes actual
      const { data: monthOrders, error: monthError } = await supabase
        .from("orders")
        .select("total, status")
        .eq("status", "paid")
        .gte("created_at", firstDayOfMonth.toISOString())

      if (monthError) throw monthError

      // Calcular ventas del mes
      const monthSales = monthOrders.reduce((sum, order) => sum + (order.total || 0), 0)

      // Obtener órdenes en cocina
      const { data: kitchenOrders, error: kitchenError } = await supabase
        .from("orders")
        .select("id")
        .eq("status", "kitchen")

      if (kitchenError) throw kitchenError

      // Obtener mesas disponibles
      const { data: tables, error: tablesError } = await supabase.from("tables").select("status")

      if (tablesError) throw tablesError

      const availableTables = tables.filter((t) => t.status === "available").length

      // Obtener meseros activos
      const { data: waiters, error: waitersError } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "waiter")
        .eq("active", true)

      if (waitersError) throw waitersError

      return {
        monthSales,
        kitchenOrdersCount: kitchenOrders.length,
        availableTables,
        totalTables: tables.length,
        activeWaiters: waiters.length,
      }
    } catch (error) {
      console.error("Error al obtener estadísticas del dashboard:", error)
      return {
        monthSales: 0,
        kitchenOrdersCount: 0,
        availableTables: 0,
        totalTables: 0,
        activeWaiters: 0,
      }
    }
  },
}
