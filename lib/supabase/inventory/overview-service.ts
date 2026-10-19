/** Inventory dashboard data (`inventory_overview`, admin only). */

import { num, rpc } from "./shared"
import type { InventoryOverview } from "./types"

type Raw = Record<string, unknown>

const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : [])

export async function getInventoryOverview(days = 30): Promise<InventoryOverview> {
  const r = await rpc<Raw>("inventory_overview", { p_days: days })
  const k = (r.kpis ?? {}) as Raw
  return {
    days: num(r.days),
    generatedAt: r.generated_at as string,
    kpis: {
      totalValue: num(k.total_value),
      itemsCount: num(k.items_count),
      activeItems: num(k.active_items),
      lowStockCount: num(k.low_stock_count),
      outOfStockCount: num(k.out_of_stock_count),
      expiringSoonCount: num(k.expiring_soon_count),
      expiredCount: num(k.expired_count),
      wasteValue: num(k.waste_value),
      purchasesValue: num(k.purchases_value),
      consumptionValue: num(k.consumption_value),
      openPurchaseOrders: num(k.open_purchase_orders),
    },
    series: list(r.series).map((s) => ({
      date: s.date as string,
      inValue: num(s.in_value),
      outValue: num(s.out_value),
      wasteValue: num(s.waste_value),
    })),
    valueByCategory: list(r.value_by_category).map((c) => ({
      categoryId: (c.category_id as string | null) ?? null,
      categoryName: (c.category_name as string | null) ?? null,
      value: num(c.value),
    })),
    topConsumed: list(r.top_consumed).map((t) => ({
      itemId: t.ingredient_id as string,
      name: t.name as string,
      unit: t.unit as string,
      quantity: num(t.quantity),
      value: num(t.value),
    })),
  }
}
