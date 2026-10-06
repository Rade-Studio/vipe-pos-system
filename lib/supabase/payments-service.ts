/**
 * Payments service: thin wrappers over the Supabase RPCs and the
 * `payment_methods` catalog read.
 *
 * The wire format is the migration's, NOT this file's: the server's
 * `pay_order(p_order_id, p_cash_register_id, p_tip_amount, p_tenders,
 * p_idempotency_key)` signature is fixed, and the snake_case arg names
 * are part of the contract the SQL test suite pins. Anything camelCase
 * here is a remap on the way in or on the way out.
 *
 * `payOrder` takes the wire format (`PayOrderTenderLine[]`) produced by
 * `buildPayOrderTenders` so the service does not need to know the
 * catalog or recompute the state. The cashier UI runs
 * `computePaymentState` → `buildPayOrderTenders` → `payOrder` and the
 * service is the last hop.
 *
 * Every error is normalized to a `PaymentServiceError` whose `kind` is
 * derived from the supabase-js `error.code` (42501, P0002, P0001, 22023).
 * The server's message is kept verbatim on `error.message` so the UI can
 * show "tenders sum to 100 but amount_due + tip = 47000" without having
 * to map SQLSTATEs again.
 */

import { supabase } from '@/lib/supabase/client'
import { PaymentServiceError } from '@/lib/payments/types'
import type {
  OrderBillSummary,
  PayOrderResult,
  PayOrderTenderEcho,
  PayOrderTenderLine,
  PaymentMethodOption,
  SplitOrderItem,
  SplitOrderResult,
  UndoSplitResult,
} from '@/lib/payments/types'

// -----------------------------------------------------------
// Supabase row + error types
// -----------------------------------------------------------

interface SupabaseLikeError {
  code?: string
  message?: string
  [k: string]: unknown
}

interface PaymentMethodRow {
  id: string
  code: string
  name: string
  kind: 'cash' | 'electronic'
  is_active: boolean
  sort_order: number
}

interface PayOrderTenderRow {
  line_no: number
  method_code: string
  amount: number
  cash_received: number | null
}

interface PayOrderResponseRow {
  payment_id: string
  status: 'paid' | 'already_paid'
  amount_due: number
  tip_amount: number
  total_charged: number
  change_given: number
  drawer_warning: boolean
  drawer_cash_before: number
  tenders: PayOrderTenderRow[]
}

interface BillRow {
  order_id: string
  subtotal: number
  tax: number
  tip: number
  total: number
}

interface SplitOrderResponseRow {
  child_order_id: string
  parent: BillRow
  child: BillRow
}

interface UndoSplitResponseRow {
  parent: BillRow
}

// -----------------------------------------------------------
// Public input shapes (camelCase, what callers speak)
// -----------------------------------------------------------

export interface PayOrderInput {
  orderId: string
  cashRegisterId: string
  tip: number
  /** Wire format from `buildPayOrderTenders(state)`. */
  tenders: PayOrderTenderLine[]
  idempotencyKey: string
}

export interface SplitOrderInput {
  parentOrderId: string
  items: { orderItemId: string; quantity: number }[]
}

export interface UndoSplitInput {
  childOrderId: string
}

// -----------------------------------------------------------
// Error mapping
// -----------------------------------------------------------

/**
 * Map a supabase-js error code to a `PaymentServiceErrorKind`.
 *
 *   42501  not-authorized   caller has no profile, or role below cashier/admin
 *   P0002  not-found        the only SQLSTATE that does not leak another
 *                           tenant's existence; used for missing orders,
 *                           partial children, parents and registers
 *   P0001  rejected         business-rule violation (sum mismatch, inactive
 *                           method, register closed, etc.); the message
 *                           is the cashier's only diagnostic
 *   22023  invalid-input    bad shape (bad uuid, negative tip, > 20 lines)
 *
 * Anything else is `unknown`. We never swallow a raw supabase error: the
 * cause is preserved on `PaymentServiceError.cause` for log scraping.
 */
function mapErrorCode(code: string | undefined): PaymentServiceError['kind'] {
  switch (code) {
    case '42501':
      return 'not-authorized'
    case 'P0002':
      return 'not-found'
    case 'P0001':
      return 'rejected'
    case '22023':
      return 'invalid-input'
    default:
      return 'unknown'
  }
}

/** A successful RPC must return a row; treat an empty payload as a failure. */
function requireData<T>(data: unknown, rpc: string): T {
  if (data === null || data === undefined) {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `${rpc} returned no data`,
    })
  }
  return data as T
}

function wrapError(error: SupabaseLikeError | null | undefined): PaymentServiceError {
  const code = error?.code
  const message = error?.message ?? 'Supabase request failed'
  return new PaymentServiceError({
    kind: mapErrorCode(code),
    message,
    cause: error ?? undefined,
  })
}

// -----------------------------------------------------------
// listPaymentMethods
// -----------------------------------------------------------

/**
 * Read the per-tenant payment-method catalog ordered by `sort_order`.
 * The server keeps inactive rows so historical payments keep resolving
 * the method they were paid with; the checkout picker filters on
 * `isActive` in the UI, not in the query.
 */
export async function listPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await (supabase as any)
    .from('payment_methods')
    .select('id, code, name, kind, is_active, sort_order')
    .order('sort_order', { ascending: true })

  if (error) throw wrapError(error)

  const rows = (data ?? []) as PaymentMethodRow[]
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }))
}

// -----------------------------------------------------------
// payOrder
// -----------------------------------------------------------

/**
 * Atomic checkout. Sends the cashier's `tenders` exactly as
 * `buildPayOrderTenders` produced them: `amount` is the per-line applied
 * amount (capped for cash, full for electronic) and `cash_received` is
 * the customer's cash on a cash line, `null` on an electronic one. The
 * server enforces the same cash-vs-electronic shape on the
 * `payment_tenders` table.
 *
 * On success returns the full summary (id, status, money math, drawer
 * state, echo of the persisted tender lines). On a replay with the
 * same idempotency key the server returns `status='already_paid'` and
 * `alreadyPaid` is mirrored to `true` for the UI.
 */
export async function payOrder(input: PayOrderInput): Promise<PayOrderResult> {
  const { data, error } = await (supabase.rpc as any)('pay_order', {
    p_order_id: input.orderId,
    p_cash_register_id: input.cashRegisterId,
    p_tip_amount: input.tip,
    p_tenders: input.tenders,
    p_idempotency_key: input.idempotencyKey,
  })

  if (error) throw wrapError(error)

  const row = requireData<PayOrderResponseRow>(data, 'pay_order')
  const tenders: PayOrderTenderEcho[] = (row.tenders ?? []).map((t) => ({
    lineNo: t.line_no,
    methodCode: t.method_code,
    amount: t.amount,
    cashReceived: t.cash_received,
  }))

  return {
    paymentId: row.payment_id,
    status: row.status,
    amountDue: row.amount_due,
    tipAmount: row.tip_amount,
    totalCharged: row.total_charged,
    changeGiven: row.change_given,
    drawerWarning: row.drawer_warning,
    drawerCashBefore: row.drawer_cash_before,
    alreadyPaid: row.status === 'already_paid',
    tenders,
  }
}

// -----------------------------------------------------------
// splitOrder / undoSplit
// -----------------------------------------------------------

/**
 * Atomic split: moves some of the parent's items into a new child
 * order (a partial order) and recomputes both bills. The server's
 * `split_order` RPC locks the parent FOR UPDATE, validates the call
 * is cashier/admin, refuses to move every line, and returns the
 * post-move parent and child summaries.
 */
export async function splitOrder(input: SplitOrderInput): Promise<SplitOrderResult> {
  const items: SplitOrderItem[] = input.items.map((i) => ({
    order_item_id: i.orderItemId,
    quantity: i.quantity,
  }))

  const { data, error } = await (supabase.rpc as any)('split_order', {
    p_parent_order_id: input.parentOrderId,
    p_items: items,
  })

  if (error) throw wrapError(error)

  const row = requireData<SplitOrderResponseRow>(data, 'split_order')
  return {
    childOrderId: row.child_order_id,
    parent: toBillSummary(row.parent),
    child: toBillSummary(row.child),
  }
}

/**
 * Atomic undo of a split. The server's `undo_split` RPC takes the
 * parent lock first to avoid deadlocks with a concurrent split, then
 * merges the child's items back into the parent (summing quantities
 * when a matching line exists, otherwise reparenting the row),
 * deletes the child order and recomputes the parent bill.
 */
export async function undoSplit(input: UndoSplitInput): Promise<UndoSplitResult> {
  const { data, error } = await (supabase.rpc as any)('undo_split', {
    p_child_order_id: input.childOrderId,
  })

  if (error) throw wrapError(error)

  const row = requireData<UndoSplitResponseRow>(data, 'undo_split')
  return { parent: toBillSummary(row.parent) }
}

function toBillSummary(row: BillRow): OrderBillSummary {
  return {
    orderId: row.order_id,
    subtotal: row.subtotal,
    tax: row.tax,
    tip: row.tip,
    total: row.total,
  }
}

// -----------------------------------------------------------
// Re-exports
// -----------------------------------------------------------

export { PaymentServiceError } from '@/lib/payments/types'
export type { PaymentServiceErrorKind } from '@/lib/payments/types'
