import { describe, expect, it } from 'vitest';
import { toOrder } from './orders.mappers';

const row = (order: Record<string, unknown>, discounts: Record<string, unknown>[] = []) => ({
  order: { id: 'o1', status: 'kitchen', order_type: 'dine_in', ...order },
  table_number: null,
  waiter_name: null,
  items: [],
  discounts,
});
const discount = (amount: number, kind = 'promotion_item') => ({ id: `d${amount}`, kind, source: 'automatic', label: 'X', amount, order_item_id: null, combo_id: null });

describe('toOrder grossSubtotal', () => {
  it('is the net subtotal plus total_discounts, the sum of the order_discounts rows', () => {
    const order = toOrder(row({ subtotal: 26000, total_discounts: 24000 }, [discount(24000)]));
    expect(order).toMatchObject({ subtotal: 26000, totalDiscounts: 24000, grossSubtotal: 50000 });
    expect(order.discounts.reduce((sum, d) => sum + d.amount, 0)).toBe(order.grossSubtotal - order.subtotal);
  });

  it('sums several rows (line, combo and bill) and equals subtotal without discounts', () => {
    const order = toOrder(row({ subtotal: 50000, total_discounts: 19000 }, [discount(9000, 'combo'), discount(10000, 'promotion_bill')]));
    expect(order.grossSubtotal).toBe(69000);
    expect(toOrder(row({ subtotal: 7000, total_discounts: 0 })).grossSubtotal).toBe(7000);
    // numeric columns may arrive as strings.
    expect(toOrder(row({ subtotal: '0', total_discounts: '33000' })).grossSubtotal).toBe(33000);
  });
});
