import { supabase } from "./client"
import type { DailySales, PopularDish } from "@/types"
import { log } from "@/lib/log"
import { POPULAR_DISHES_DAYS } from "@/lib/admin/dashboard"

/**
 * Dashboard reads.
 *
 * T9 (`odd/tasks/cargas-por-perfil.md` S1/S2): this used to expose one
 * `getDashboardStats()` that chained FOUR reads one after the other (paid
 * orders of the month, kitchen orders, tables, waiters) and the view called it
 * plus three more reads from a single `useEffect`, all sequential, on every
 * mount of the Dashboard tab. Two of those four duplicated data the shell had
 * already loaded for the admin (`lib/shell/startup-loads.ts`), and
 * `getPopularDishes` pulled EVERY paid order_item ever — no date bound, no
 * limit on the rows it read.
 *
 * Each read below is independent (so React Query can run them in parallel) and
 * every windowed read takes its `since` bound explicitly, so an unbounded read
 * is not reachable from a call site by accident.
 */
export const dashboardService = {
  /**
   * Ventas del mes: the sum of `total` for the paid orders since `sinceIso`.
   */
  async getMonthSales(sinceIso: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("total")
        .eq("status", "paid")
        .gte("created_at", sinceIso)

      if (error) throw error

      return (data || []).reduce((sum, order) => sum + (order.total || 0), 0)
    } catch (error) {
      log.error("Error al obtener las ventas del mes:", { error: String(error) })
      return 0
    }
  },

  /**
   * How many orders sit in a status right now (the "Órdenes en Cocina" card).
   */
  async countOrdersByStatus(status: string): Promise<number> {
    try {
      const { data, error } = await supabase.from("orders").select("id").eq("status", status)

      if (error) throw error

      return (data || []).length
    } catch (error) {
      log.error("Error al contar órdenes por estado:", { error: String(error), status })
      return 0
    }
  },

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
        const date = order.created_at ? new Date(order.created_at).toISOString().split("T")[0] : ""
        const currentTotal = salesByDay.get(date) || 0
        salesByDay.set(date, currentTotal + (order.total || 0))
      })

      // Convertir a array de DailySales
      return Array.from(salesByDay.entries()).map(([date, amount]) => ({
        date: date,
        amount: amount,
      }))
    } catch (error) {
      log.error("Error al obtener ventas diarias:", { error: String(error) })
      return []
    }
  },

  /**
   * Obtiene los platos más populares basados en la cantidad vendida.
   *
   * BOUNDED on purpose (T9): the embedded order is filtered by `created_at`
   * since `sinceIso`, so the read is the last `POPULAR_DISHES_DAYS` days
   * instead of every paid item the tenant has ever sold. `created_at` has to
   * be part of the `orders!inner(...)` projection for that bound to filter the
   * embedded rows.
   *
   * @param limit Número máximo de platos a retornar (por defecto 10)
   * @param sinceIso Límite inferior de la ventana (por defecto, hace 30 días)
   */
  async getPopularDishes(
    limit = 10,
    sinceIso: string = new Date(Date.now() - POPULAR_DISHES_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  ): Promise<PopularDish[]> {
    try {
      // Consulta para obtener los items de órdenes pagadas dentro de la ventana
      const { data: orderItems, error: itemsError } = await supabase
        .from("order_items")
        .select(`
          name,
          dish_id,
          quantity,
          orders!inner(status, created_at)
        `)
        .eq("orders.status", "paid")
        .gte("orders.created_at", sinceIso)

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
      log.error("Error al obtener platos populares:", { error: String(error) })
      return []
    }
  },
}