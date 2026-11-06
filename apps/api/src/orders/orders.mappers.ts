import { toIso } from '../common/validation';
import { toLegacyTransaction, toPayment } from '../payments/payments.mappers';
import type { CompletedOrder, Order, OrderItem, OrderStatus, OrderType, StockShortage } from './orders.dto';

type Json = Record<string, unknown>;

/** One row of OrdersService.select: the order and its items as jsonb, plus the joined names. */
export interface OrderRow {
  order: Json;
  table_number: number | null;
  waiter_name: string | null;
  items: Json[];
}

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const time = (value: unknown) => toIso(text(value));
/** numeric columns arrive as JSON numbers through to_jsonb. */
const num = (value: unknown) => Number(value ?? 0);

export const toOrderItem = (row: Json): OrderItem => ({
  id: String(row.id),
  orderId: text(row.order_id),
  dishId: text(row.dish_id),
  name: String(row.name),
  price: num(row.price),
  quantity: num(row.quantity),
  comments: text(row.comments),
  status: String(row.status ?? 'kitchen'),
  addedAt: time(row.added_at),
  createdAt: time(row.created_at),
  updatedAt: time(row.updated_at),
});

export function toOrder(row: OrderRow, include: { withTable?: boolean; withWaiter?: boolean } = {}): Order {
  const o = row.order;
  const order: Order = {
    id: String(o.id),
    orderNumber: num(o.order_number),
    guests: o.guests === null || o.guests === undefined ? null : num(o.guests),
    notes: text(o.notes),
    tableId: text(o.table_id),
    waiterId: text(o.waiter_id),
    status: o.status as OrderStatus,
    orderType: o.order_type as OrderType,
    subtotal: num(o.subtotal),
    tax: num(o.tax),
    taxPercentage: num(o.tax_percentage),
    tip: num(o.tip),
    tipPercentage: num(o.tip_percentage),
    total: num(o.total),
    totalDiscounts: num(o.total_discounts),
    isPartialOrder: o.is_partial_order === true,
    parentOrderId: text(o.parent_order_id),
    createdAt: time(o.created_at),
    updatedAt: time(o.updated_at),
    items: row.items.map(toOrderItem),
  };
  if (include.withTable) {
    order.tableNumber = row.table_number;
  }
  if (include.withWaiter) {
    order.waiterName = row.waiter_name;
  }
  return order;
}

/** A row of OrdersService.completed: an OrderRow plus the payment and the legacy rows as jsonb. */
export interface CompletedOrderRow extends OrderRow {
  payment: Json | null;
  legacy_transactions: Json[];
}

export const toCompletedOrder = (row: CompletedOrderRow): CompletedOrder => ({
  ...toOrder(row),
  payment: row.payment ? toPayment(row.payment) : null,
  legacyTransactions: row.legacy_transactions.map(toLegacyTransaction),
});

/** check_dishes_stock shortage (snake_case jsonb) as the 409 body entry. */
export const toShortage = (row: Json): StockShortage => ({
  ingredientId: String(row.ingredient_id),
  name: String(row.name),
  unit: String(row.unit),
  required: num(row.required),
  available: num(row.available),
  missing: num(row.missing),
});
