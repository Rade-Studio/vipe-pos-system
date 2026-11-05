/**
 * Stock seen from the sale: the order consumption (`consume_order_stock`,
 * idempotent, a no-op when inventory control is disabled), the pre-send
 * shortage report (`check_dishes_stock`) and the menu grid availability.
 */

import { api } from "@/lib/api/client"
import { required } from "./shared"
import type { ConsumeOrderStockResult, DishStockCheckItem, DishStockCheckResult } from "./types"

export async function consumeOrderStock(orderId: string): Promise<ConsumeOrderStockResult> {
  const { data } = await api.POST("/api/inventory/consume", { body: { orderId } })
  return required(data)
}

export async function checkDishesStock(items: DishStockCheckItem[]): Promise<DishStockCheckResult> {
  const { data } = await api.POST("/api/inventory/check-stock", { body: { items } })
  return required(data)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A usable dish id: the first 36 characters (ids sometimes arrive concatenated), when they form a UUID. */
function normalizeDishId(id: string): string | null {
  const head = id ? id.slice(0, 36) : ""
  return UUID.test(head) ? head : null
}

/**
 * One read for every dish on screen (T10): the server decides with the
 * `check_dishes_stock` rule (one portion against the default-location
 * balance; everything available when inventory control is off). Unknown ids
 * are left out of the answer and of the map, so the grid, which only blocks
 * `=== false`, shows them as available.
 */
export async function checkStockForDishes(dishIds: string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(dishIds.map(normalizeDishId).filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  const { data } = await api.POST("/api/inventory/dish-availability", { body: { dishIds: ids } })
  return new Map(Object.entries(required(data)))
}

/** One dish; available when the id is unusable or unknown to the server. */
export async function checkStockForDish(dishId: string): Promise<boolean> {
  const id = normalizeDishId(dishId)
  if (!id) return true
  return (await checkStockForDishes([id])).get(id) ?? true
}
