import { Injectable } from '@nestjs/common';
import { sql } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import type { ConsumeOrderStockResult, DishStockCheckItem, DishStockCheckResult, InventoryOverview } from './inventory.dto';
import { rows, rpc } from './inventory-sql';
import { toCheckStockResult, toConsumeResult, toOverview } from './inventory.mappers';

/**
 * Sale-side stock and the inventory dashboard: `check_dishes_stock`,
 * `consume_order_stock` (idempotent, no-op when inventory control is off),
 * the one dish availability rule, and `inventory_overview`.
 */
@Injectable()
export class SalesService {
  constructor(private readonly uow: UnitOfWork) {}

  async checkStock(items: DishStockCheckItem[]): Promise<DishStockCheckResult> {
    const cart = items.map((item) => ({ dish_id: item.dishId, quantity: item.quantity }));
    return toCheckStockResult(await rpc(this.uow, sql`SELECT public.check_dishes_stock(${JSON.stringify(cart)}::jsonb) AS result`));
  }

  async consume(orderId: string): Promise<ConsumeOrderStockResult> {
    return toConsumeResult(await rpc(this.uow, sql`SELECT public.consume_order_stock(${orderId}::uuid) AS result`));
  }

  /**
   * `dishId -> available` for one portion of each dish, decided by
   * `check_dishes_stock` itself: control off -> available; otherwise every
   * formula input must be covered by the default-location balance (negative
   * as 0); a dish without formula is available. Ids the caller cannot see
   * (unknown or another tenant's) are left out.
   */
  async availability(dishIds: string[]): Promise<Record<string, boolean>> {
    if (!dishIds.length) {
      return {};
    }
    const result = await rows<{ id: string; ok: boolean }>(this.uow, sql`
      SELECT d.id,
             (public.check_dishes_stock(jsonb_build_array(jsonb_build_object('dish_id', d.id, 'quantity', 1)))->>'ok')::boolean AS ok
        FROM public.dishes d
       WHERE d.id = ANY(${sql.param(dishIds)}::uuid[])`);
    return Object.fromEntries(result.map((row) => [row.id, row.ok]));
  }

  async overview(days: number): Promise<InventoryOverview> {
    return toOverview(await rpc(this.uow, sql`SELECT public.inventory_overview(${days}::integer) AS result`));
  }
}
