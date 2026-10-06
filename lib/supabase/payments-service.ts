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
import { parseRegisterSummary } from '@/lib/payments/register-summary'
import type { RegisterSummary } from '@/lib/payments/register-summary'
import {
  parsePaymentRows,
} from '@/lib/payments/payment-list'
import type { PaymentRow } from '@/lib/payments/payment-list'
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

/** A successful RPC must return its row; a missing key field is a failure. */
function requireData<T>(data: unknown, rpc: string, key: string): T {
  if (data === null || typeof data !== 'object' || !(key in data)) {
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

  const row = requireData<PayOrderResponseRow>(data, 'pay_order', 'payment_id')
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

  const row = requireData<SplitOrderResponseRow>(data, 'split_order', 'child_order_id')
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

  const row = requireData<UndoSplitResponseRow>(data, 'undo_split', 'parent')
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
// register_summary / closeRegister
// -----------------------------------------------------------

interface RegisterSummaryRow {
  registers_count: number
  initial_cash: number
  payments_count: number
  total_billed: number
  total_tips: number
  total_sales: number
  total_change: number
  methods: unknown
  cash_deposits: number
  cash_withdrawals: number
  expected_cash: number
  tips_payout: number
  expected_cash_after_tips: number
  legacy: unknown
}

interface CloseRegisterRow {
  status: 'closed' | 'already_closed'
  cash_register_id: string
  final_cash: number
  summary: RegisterSummaryRow
}

/**
 * Server-side aggregation for the close-register screen and the admin
 * reports. Thin wrapper over `register_summary(p_cash_register_ids)`.
 * The server computes every number (expected_cash, tips_payout, the
 * methods array, the legacy block) and returns them as a single jsonb
 * object; the client only validates the shape via
 * `parseRegisterSummary` and maps it to camelCase.
 *
 * Caller: the cashier/admin UI after the open dialog, the close
 * dialog before confirmation, the admin reports per date. The server
 * itself rejects non-cashier/admin callers and any id the caller's RLS
 * cannot see (42501 / P0002).
 */
export async function getRegisterSummary(ids: string[]): Promise<RegisterSummary> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new PaymentServiceError({
      kind: 'invalid-input',
      message: 'getRegisterSummary: ids must be a non-empty array',
    })
  }

  const { data, error } = await (supabase.rpc as any)('register_summary', {
    p_cash_register_ids: ids,
  })

  if (error) throw wrapError(error)

  const row = requireData<RegisterSummaryRow>(data, 'register_summary', 'registers_count')
  try {
    return parseRegisterSummary(row)
  } catch (parseErr) {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `register_summary returned a malformed payload: ${(parseErr as Error).message}`,
      cause: parseErr,
    })
  }
}

/**
 * Closes a single cash register. The server takes the run of the
 * drawer (FOR UPDATE on cash_registers, same row pay_order takes FOR
 * SHARE on) so a concurrent pay_order waits on the close, computes the
 * summary at the lock instant, UPDATEs status='closed' +
 * final_cash=expected_cash_after_tips, and returns the final_cash the
 * UI should display. The browser does NOT recompute final cash: the
 * server is the only authority.
 *
 * On a replay (status='closed' when the lock lands) the server returns
 * the same shape with status='already_closed' and the stored final_cash;
 * no writes happen. The UI treats that the same as a fresh close.
 */
export async function closeRegisterRpc(
  cashRegisterId: string,
): Promise<CloseRegisterResult> {
  const { data, error } = await (supabase.rpc as any)('close_register', {
    p_cash_register_id: cashRegisterId,
  })

  if (error) throw wrapError(error)

  const row = requireData<CloseRegisterRow>(data, 'close_register', 'status')
  if (row.status !== 'closed' && row.status !== 'already_closed') {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `close_register returned an unknown status: ${row.status}`,
    })
  }

  let summary: RegisterSummary
  try {
    summary = parseRegisterSummary(row.summary)
  } catch (parseErr) {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `close_register returned a malformed summary: ${(parseErr as Error).message}`,
      cause: parseErr,
    })
  }

  return {
    status: row.status,
    cashRegisterId: row.cash_register_id,
    finalCash: row.final_cash,
    summary,
  }
}

/** Wire re-export of the camelCase close result. */
export interface CloseRegisterResult {
  status: 'closed' | 'already_closed'
  cashRegisterId: string
  finalCash: number
  summary: RegisterSummary
}

// -----------------------------------------------------------
// listRegisterPayments / getPaymentsByOrderIds
// -----------------------------------------------------------

// The column list is the server's snake_case + a nested `payment_tenders(*)`
// for the line breakdown. The leading columns are the ones
// `parsePaymentRows` requires; payment_tenders is the nested shape the
// UI renders (method label, amount, change).
const PAYMENTS_SELECT =
  'id, order_id, cash_register_id, cashier_profile_id, amount_due, tip_amount, total_charged, change_given, idempotency_key, created_at, payment_tenders(*)'

/**
 * Read every payment taken on one or more cash registers (joined to its
 * tender lines), ordered newest first. Empty `ids` short-circuits so the
 * hook stays safe when the UI has nothing selected yet (a network round
 * trip with an empty filter is a 400 from PostgREST).
 *
 * Caller: `useRegisterPayments` (the cashier/admin transaction lists) -
 * the only authoritative source of "what was sold on this register".
 * Legacy `payment_transactions` is rendered as a separate read-only block.
 */
export async function listRegisterPayments(registerIds: string[]): Promise<PaymentRow[]> {
  if (!Array.isArray(registerIds) || registerIds.length === 0) {
    return []
  }
  const { data, error } = await (supabase as any)
    .from('payments')
    .select(PAYMENTS_SELECT)
    .in('cash_register_id', registerIds)
    .order('created_at', { ascending: false })

  if (error) throw wrapError(error)

  try {
    return parsePaymentRows(data)
  } catch (parseErr) {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `listRegisterPayments returned a malformed payload: ${(parseErr as Error).message}`,
      cause: parseErr,
    })
  }
}

/**
 * Same read as `listRegisterPayments` but filtered by `order_id in(ids)`.
 * Drives the per-order method label on `CompletedOrdersTable`: the
 * cashier/admin report needs a stable method name even when a bill was
 * paid across multiple tender lines.
 *
 * Empty `orderIds` short-circuits the same way; the caller's React state
 * may be empty between a date change and the first render.
 */
export async function getPaymentsByOrderIds(orderIds: string[]): Promise<PaymentRow[]> {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return []
  }
  const { data, error } = await (supabase as any)
    .from('payments')
    .select(PAYMENTS_SELECT)
    .in('order_id', orderIds)
    .order('created_at', { ascending: false })

  if (error) throw wrapError(error)

  try {
    return parsePaymentRows(data)
  } catch (parseErr) {
    throw new PaymentServiceError({
      kind: 'unknown',
      message: `getPaymentsByOrderIds returned a malformed payload: ${(parseErr as Error).message}`,
      cause: parseErr,
    })
  }
}

// -----------------------------------------------------------
// Re-exports
// -----------------------------------------------------------

export { PaymentServiceError } from '@/lib/payments/types'
export type { PaymentServiceErrorKind } from '@/lib/payments/types'
