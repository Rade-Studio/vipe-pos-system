/**
 * Shared types for the multi-tender payment domain.
 *
 * Everything here is pure data: no Supabase, no DOM, no zustand. The client
 * UI, the optimistic state, and the payments-service all speak these shapes.
 *
 * Money is whole Colombian pesos (COP). No cents exist, so any non-integer
 * amount is a parsing or arithmetic bug and the compute helpers reject it
 * with a typed issue rather than rounding silently.
 */

// -----------------------------------------------------------
// Payment-method catalog
// -----------------------------------------------------------

export type PaymentMethodKind = 'cash' | 'electronic'

/**
 * One row of the per-tenant `payment_methods` catalog, in the shape the
 * browser actually consumes. The server stores `sort_order` and
 * `is_active` in snake_case; the service remaps once and everything else
 * reads camelCase.
 */
export interface PaymentMethodOption {
  id: string
  code: string
  name: string
  kind: PaymentMethodKind
  isActive: boolean
  sortOrder: number
}

// -----------------------------------------------------------
// Tender input (what the user types in the checkout UI)
// -----------------------------------------------------------

/**
 * One tender line as the cashier enters it.
 *
 * `tendered` means "the cash the customer handed over" for a cash method
 * and "the amount that will be charged" for an electronic method. The
 * bill's `applied` (what counts toward the bill) is computed from
 * `tendered` in `computePaymentState` and may be lower than `tendered`
 * when the line overpays or returns change.
 */
export interface TenderDraft {
  methodId: string
  tendered: number
}

// -----------------------------------------------------------
// Issues (typed validation failures, never thrown)
// -----------------------------------------------------------

export type PaymentIssueCode =
  | 'electronic-overpay' // electronic tendered > remainingBefore
  | 'line-not-needed' // line applied 0 (everything already covered)
  | 'unknown-method' // methodId not present in the catalog
  | 'inactive-method' // methodId is in the catalog but isActive is false
  | 'invalid-amount' // tendered is not a positive whole peso
  | 'invalid-tip' // tip is negative or non-integer
  | 'too-many-lines' // > 20 tender lines
  | 'nothing-to-charge' // amountDue <= 0

export interface PaymentIssue {
  code: PaymentIssueCode
  /** 0-based line index, when the issue is about a specific line. */
  lineIndex?: number
  message: string
}

// -----------------------------------------------------------
// Computed tender line + payment state
// -----------------------------------------------------------

export interface ComputedTenderLine {
  methodId: string
  kind: PaymentMethodKind
  /** What the cashier entered. */
  tendered: number
  /** What counts against the bill. Capped by remainingBefore for cash. */
  applied: number
  /** cash: tendered - applied; electronic: 0. */
  change: number
}

export interface PaymentState {
  /** amountDue + tip; what the customer has to cover. */
  totalToCharge: number
  lines: ComputedTenderLine[]
  /** Sum of every line's `applied`. */
  applied: number
  /** totalToCharge - applied, clamped to >= 0. */
  remaining: number
  /** Sum of every cash line's `change`. */
  totalChange: number
  issues: PaymentIssue[]
  /** True only when issues is empty and remaining is 0. */
  canSubmit: boolean
}

// -----------------------------------------------------------
// Bill
// -----------------------------------------------------------

export interface Bill {
  subtotal: number
  tax: number
  suggestedTip: number
  amountDue: number
}

// -----------------------------------------------------------
// Server wire format (snake_case, what we send to pay_order)
// -----------------------------------------------------------

export interface PayOrderTenderLine {
  payment_method_id: string
  amount: number
  cash_received: number | null
}

export interface SplitOrderItem {
  order_item_id: string
  quantity: number
}

// -----------------------------------------------------------
// Server response (camelCase, what the UI consumes)
// -----------------------------------------------------------

export interface PayOrderTenderEcho {
  lineNo: number
  methodCode: string
  amount: number
  cashReceived: number | null
}

export interface PayOrderResult {
  paymentId: string
  status: 'paid' | 'already_paid'
  amountDue: number
  tipAmount: number
  totalCharged: number
  changeGiven: number
  drawerWarning: boolean
  drawerCashBefore: number
  /** Convenience mirror of `status === 'already_paid'`. */
  alreadyPaid: boolean
  tenders: PayOrderTenderEcho[]
}

export interface OrderBillSummary {
  orderId: string
  subtotal: number
  tax: number
  tip: number
  total: number
}

export interface SplitOrderResult {
  childOrderId: string
  parent: OrderBillSummary
  child: OrderBillSummary
}

export interface UndoSplitResult {
  parent: OrderBillSummary
}

// -----------------------------------------------------------
// Service error
// -----------------------------------------------------------

export type PaymentServiceErrorKind =
  | 'not-authorized' // supabase-js error.code === '42501'
  | 'not-found' // 'P0002' (the only SQLSTATE that does not leak another tenant)
  | 'rejected' // 'P0001' business rule violation; server message explains
  | 'invalid-input' // '22023' invalid_parameter_value
  | 'unknown' // anything else

export interface PaymentServiceErrorInit {
  kind: PaymentServiceErrorKind
  message: string
  /** Raw supabase-js error for callers that need the original shape. */
  cause?: unknown
}

export class PaymentServiceError extends Error {
  readonly kind: PaymentServiceErrorKind
  readonly cause?: unknown

  constructor(init: PaymentServiceErrorInit) {
    super(init.message)
    this.name = 'PaymentServiceError'
    this.kind = init.kind
    this.cause = init.cause
  }
}
