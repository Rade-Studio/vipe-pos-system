import { toIso } from '../common/validation';
import { numOrNull, req } from '../payments/payments.mappers';
import {
  type ClosedTodaySummary,
  type Courier,
  type Customer,
  type CustomerAddress,
  type CustomerHistory,
  DELIVERY_STATUSES,
  type DeliveryOrder,
  type DeliveryOrderWithBill,
  type DeliveryStatus,
  PAYMENT_MODES,
  type PaymentMode,
} from './delivery.dto';

type Json = Record<string, unknown>;

/** Strict like lib/delivery/parse.ts: a missing required column is a 500, never a silent default. */
function str(row: Json, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Database result is missing the required field ${field}`);
  }
  return value;
}
/** Nullable text; '' reads as null like the web parser. */
const textOrNull = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const time = (row: Json, field: string) => toIso(str(row, field));
const timeOrNull = (value: unknown) => toIso(textOrNull(value));
function bool(row: Json, field: string): boolean {
  if (typeof row[field] !== 'boolean') {
    throw new Error(`Database result is missing the required field ${field}`);
  }
  return row[field] as boolean;
}
function oneOf<T extends string>(row: Json, field: string, values: readonly T[]): T {
  const value = str(row, field);
  if (!values.includes(value as T)) {
    throw new Error(`Database result has an unexpected ${field}: ${value}`);
  }
  return value as T;
}

/**
 * One `to_jsonb(order_deliveries)` row plus `prepaid_method_name` (the
 * DELIVERY_ROW select in the service; the RPCs' own result lacks the name).
 */
export const toDeliveryOrder = (row: Json): DeliveryOrder => ({
  orderId: str(row, 'order_id'),
  customerId: str(row, 'customer_id'),
  customerName: str(row, 'customer_name'),
  customerPhone: str(row, 'customer_phone'),
  addressLine: str(row, 'address_line'),
  neighborhood: textOrNull(row.neighborhood),
  addressReference: textOrNull(row.address_reference),
  deliveryFee: req(row, 'delivery_fee'),
  paymentMode: oneOf<PaymentMode>(row, 'payment_mode', PAYMENT_MODES),
  cashChangeFor: numOrNull(row.cash_change_for),
  prepaidMethod: textOrNull(row.prepaid_method_id) === null
    ? null
    : { id: str(row, 'prepaid_method_id'), name: str(row, 'prepaid_method_name') },
  courierId: textOrNull(row.courier_id),
  courierEta: timeOrNull(row.courier_eta),
  courierLocation: textOrNull(row.courier_location),
  returnedAt: timeOrNull(row.returned_at),
  status: oneOf<DeliveryStatus>(row, 'delivery_status', DELIVERY_STATUSES),
  failureReason: textOrNull(row.failure_reason),
  notes: textOrNull(row.notes),
  dispatchedAt: timeOrNull(row.dispatched_at),
  deliveredAt: timeOrNull(row.delivered_at),
  failedAt: timeOrNull(row.failed_at),
  cancelledAt: timeOrNull(row.cancelled_at),
  createdAt: time(row, 'created_at'),
  updatedAt: time(row, 'updated_at'),
});

export const toCustomer = (row: Json): Customer => ({
  id: str(row, 'id'),
  phone: str(row, 'phone'),
  name: str(row, 'name'),
  notes: textOrNull(row.notes),
  createdAt: time(row, 'created_at'),
  updatedAt: time(row, 'updated_at'),
});

export const toCustomerAddress = (row: Json): CustomerAddress => ({
  id: str(row, 'id'),
  customerId: str(row, 'customer_id'),
  label: textOrNull(row.label),
  addressLine: str(row, 'address_line'),
  neighborhood: textOrNull(row.neighborhood),
  reference: textOrNull(row.reference),
  isDefault: bool(row, 'is_default'),
  createdAt: time(row, 'created_at'),
  updatedAt: time(row, 'updated_at'),
});

export const toCourier = (row: Json): Courier => ({
  id: str(row, 'id'),
  name: str(row, 'name'),
  phone: textOrNull(row.phone),
  isActive: bool(row, 'is_active'),
  createdAt: time(row, 'created_at'),
  updatedAt: time(row, 'updated_at'),
});

/** `{orders_count, last_order_at, last_address}` of the customer's counted deliveries. */
export const toCustomerHistory = (row: Json): CustomerHistory => {
  const last = row.last_address as Json | null;
  return {
    ordersCount: req(row, 'orders_count'),
    lastOrderAt: timeOrNull(row.last_order_at),
    lastAddress: last
      ? { addressLine: str(last, 'address_line'), neighborhood: textOrNull(last.neighborhood), reference: textOrNull(last.address_reference) }
      : null,
  };
};

export const toClosedTodaySummary = (row: Json): ClosedTodaySummary => ({
  deliveredCount: req(row, 'delivered'),
  cancelledCount: req(row, 'cancelled'),
  failedCount: req(row, 'failed'),
  averageDeliveryMinutes: numOrNull(row.average_minutes),
});

/** `{delivery, subtotal, tax, status}` of GET /delivery/active; amountDue = subtotal + tax, as the web computed it. */
export function toDeliveryWithBill(row: { delivery: Json; bill: Json }): DeliveryOrderWithBill {
  const subtotal = req(row.bill, 'subtotal');
  const tax = req(row.bill, 'tax');
  return {
    delivery: toDeliveryOrder(row.delivery),
    amountDue: subtotal + tax,
    subtotal,
    tax,
    isPaid: str(row.bill, 'status') === 'paid',
  };
}
