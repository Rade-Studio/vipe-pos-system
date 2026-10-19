/**
 * Sale-side stock: idempotent consumption of an order (`consume_order_stock`,
 * no-op when inventory control is disabled) and the pre-send shortage report
 * (`check_dishes_stock`).
 */

import { num, rpc } from "./shared"
import type { ConsumeOrderStockResult, DishStockCheckItem, DishStockCheckResult } from "./types"

type Raw = Record<string, unknown>

const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : [])

export async function consumeOrderStock(orderId: string): Promise<ConsumeOrderStockResult> {
  const r = await rpc<Raw>("consume_order_stock", { p_order_id: orderId })
  return {
    orderId: r.order_id as string,
    enabled: Boolean(r.enabled),
    consumedItems: num(r.consumed_items),
    totalCost: num(r.total_cost),
    shortages: list(r.shortages).map((s) => ({
      itemId: s.ingredient_id as string,
      name: s.name as string,
      unit: s.unit as string,
      missing: num(s.missing),
    })),
  }
}

export async function checkDishesStock(items: DishStockCheckItem[]): Promise<DishStockCheckResult> {
  const r = await rpc<Raw>("check_dishes_stock", {
    p_items: items.map((i) => ({ dish_id: i.dishId, quantity: i.quantity })),
  })
  return {
    ok: Boolean(r.ok),
    enabled: Boolean(r.enabled),
    shortages: list(r.shortages).map((s) => ({
      itemId: s.ingredient_id as string,
      name: s.name as string,
      unit: s.unit as string,
      required: num(s.required),
      available: num(s.available),
      missing: num(s.missing),
    })),
  }
}
