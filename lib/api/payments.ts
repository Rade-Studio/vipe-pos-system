import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { PaymentServiceError, type PaymentServiceErrorKind } from "@/lib/payments/types"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { normalizeTenderReference } from "@/lib/payments/tenders"
import type { PaymentRow } from "@/lib/payments/payment-list"
import type {
  PayOrderResult,
  PayOrderTenderLine,
  PaymentMethodKind,
  PaymentMethodOption,
  SplitOrderResult,
  UndoSplitResult,
} from "@/lib/payments/types"

/**
 * Payments through the API (T9). The server owns what the browser used to do
 * with Supabase: the method `code` slug and `sortOrder` on create, the atomic
 * reorder, `pay_order` / `split_order` / `undo_split` / `register_summary` /
 * `close_register` with their exact argument mapping, and the close timestamp.
 *
 * Every failure becomes a `PaymentServiceError` (see `paymentErrorOf`) whose
 * `kind` drives the cashier and admin toasts; the server message is kept
 * verbatim so `rejected` / `invalid-input` toasts can show it.
 */

type Schemas = components["schemas"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

// ---- Errors -------------------------------------------------------------------

/**
 * SQLSTATE -> kind. The API error body carries the SQLSTATE in `code` for
 * database-originated 4xx:
 *
 *   42501        not-authorized  role below cashier/admin
 *   P0002        not-found       missing order/register (no cross-tenant leak)
 *   P0001        rejected        business rule (sum mismatch, register closed...)
 *   23505        rejected        unique violation
 *   22023/23514  invalid-input   bad parameter / CHECK constraint
 */
const KIND_BY_CODE: Record<string, PaymentServiceErrorKind> = {
  "42501": "not-authorized",
  P0002: "not-found",
  P0001: "rejected",
  "23505": "rejected",
  "22023": "invalid-input",
  "23514": "invalid-input",
}

/**
 * Any error -> `PaymentServiceError`. With a `code` the SQLSTATE decides;
 * without one, a 422 is the API's own validation (zod) -> invalid-input and a
 * 409 is an API conflict (`A register is already open`, `Register is closed`
 * on cash movements) -> rejected. Anything else is unknown; the original error
 * stays on `cause`.
 */
export function paymentErrorOf(error: unknown): PaymentServiceError {
  if (error instanceof PaymentServiceError) return error
  if (error instanceof ApiError) {
    const code = typeof error.body.code === "string" ? error.body.code : undefined
    const kind: PaymentServiceErrorKind = code
      ? (KIND_BY_CODE[code] ?? "unknown")
      : error.status === 422
        ? "invalid-input"
        : error.status === 409
          ? "rejected"
          : error.status === 403 || error.status === 401
            ? "not-authorized"
            : "unknown"
    return new PaymentServiceError({ kind, message: error.message, cause: error })
  }
  const message = error instanceof Error ? error.message : "Payment request failed"
  return new PaymentServiceError({ kind: "unknown", message, cause: error })
}

/** Runs one API call and normalizes whatever it throws. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw paymentErrorOf(error)
  }
}

// ---- Payment methods ------------------------------------------------------------

/** Every method of the restaurant, inactive ones included, by `sortOrder`. */
export function listPaymentMethods(): Promise<PaymentMethodOption[]> {
  return call(async () => {
    const { data } = await api.GET("/api/payments/methods")
    return required(data)
  })
}

export interface CreatePaymentMethodInput {
  name: string
  kind: PaymentMethodKind
}

/** The server derives the unique `code` and appends at `max(sortOrder) + 1`. */
export function createPaymentMethod(input: CreatePaymentMethodInput): Promise<PaymentMethodOption> {
  return call(async () => {
    const { data } = await api.POST("/api/payments/methods", { body: { name: input.name.trim(), kind: input.kind } })
    return required(data)
  })
}

export interface UpdatePaymentMethodInput {
  name?: string
  isActive?: boolean
}

/** `code` is immutable and `sortOrder` goes through `reorderPaymentMethods`. */
export function updatePaymentMethod(id: string, input: UpdatePaymentMethodInput): Promise<PaymentMethodOption> {
  const body: Schemas["UpdatePaymentMethodRequest"] = {}
  if (input.name !== undefined) body.name = input.name.trim()
  if (input.isActive !== undefined) body.isActive = input.isActive
  return call(async () => {
    const { data } = await api.PATCH("/api/payments/methods/{id}", { ...byId(id), body })
    return required(data)
  })
}

/** Atomic reorder: every method id of the restaurant, once, in the new order. */
export function reorderPaymentMethods(ids: readonly string[]): Promise<PaymentMethodOption[]> {
  return call(async () => {
    const { data } = await api.PUT("/api/payments/methods/order", { body: { ids: [...ids] } })
    return required(data)
  })
}

// ---- payOrder ---------------------------------------------------------------------

export interface PayOrderInput {
  orderId: string
  cashRegisterId: string
  tip: number
  /** From `buildPayOrderTenders(state)`. */
  tenders: PayOrderTenderLine[]
  idempotencyKey: string
}

/**
 * Atomic checkout over `pay_order`. `cashReceived` travels only on cash lines
 * and `reference` (normalized, non-empty) only on the others, so a line
 * without a reference sends the same body as before; a replay with the same
 * key answers `alreadyPaid: true`.
 */
export function payOrder(input: PayOrderInput): Promise<PayOrderResult> {
  const tenders: Schemas["PayOrderTenderInput"][] = input.tenders.map((line) => {
    if (line.cash_received !== null) {
      return { paymentMethodId: line.payment_method_id, amount: line.amount, cashReceived: line.cash_received }
    }
    const reference = normalizeTenderReference(line.reference)
    return reference === null
      ? { paymentMethodId: line.payment_method_id, amount: line.amount }
      : { paymentMethodId: line.payment_method_id, amount: line.amount, reference }
  })
  return call(async () => {
    const { data } = await api.POST("/api/payments", {
      body: {
        orderId: input.orderId,
        cashRegisterId: input.cashRegisterId,
        tipAmount: input.tip,
        tenders,
        idempotencyKey: input.idempotencyKey,
      },
    })
    return required(data)
  })
}

// ---- splitOrder / undoSplit -----------------------------------------------------------

export interface SplitOrderInput {
  parentOrderId: string
  items: { orderItemId: string; quantity: number }[]
}

export interface UndoSplitInput {
  childOrderId: string
}

/** Moves some items of the parent into a new partial order; both bills recomputed. */
export function splitOrder(input: SplitOrderInput): Promise<SplitOrderResult> {
  return call(async () => {
    const { data } = await api.POST("/api/orders/{id}/split", { ...byId(input.parentOrderId), body: { items: input.items } })
    return required(data)
  })
}

/** Merges a partial order back into its parent. */
export function undoSplit(input: UndoSplitInput): Promise<UndoSplitResult> {
  return call(async () => {
    const { data } = await api.POST("/api/orders/{id}/undo-split", byId(input.childOrderId))
    return required(data)
  })
}

// ---- register_summary / close_register ------------------------------------------------

/** Server-side totals for a set of registers; the browser recomputes nothing. */
export function getRegisterSummary(ids: string[]): Promise<RegisterSummary> {
  if (ids.length === 0) {
    return Promise.reject(
      new PaymentServiceError({ kind: "invalid-input", message: "getRegisterSummary: ids must be a non-empty array" }),
    )
  }
  return call(async () => {
    const { data } = await api.GET("/api/registers/summary", { params: { query: { ids: ids.join(",") } } })
    return required(data)
  })
}

export interface CloseRegisterResult {
  status: "closed" | "already_closed"
  cashRegisterId: string
  /** `expected_cash_after_tips` at the close, stored by the server. */
  finalCash: number
  /** Server clock of the close (the original one on a replay). */
  closingTimestamp: Date
  summary: RegisterSummary
}

/** `close_register`: a replay answers `already_closed` with the stored values. */
export function closeRegisterRpc(
  cashRegisterId: string,
  options: { leaveOpenOrders?: boolean } = {},
): Promise<CloseRegisterResult> {
  return call(async () => {
    // The body goes only with the confirmation: without open orders the close needs none.
    const request = options.leaveOpenOrders
      ? { ...byId(cashRegisterId), body: { leaveOpenOrders: true } }
      : byId(cashRegisterId)
    const { data } = await api.POST("/api/registers/{id}/close", request)
    const result = required(data)
    return { ...result, closingTimestamp: new Date(result.closingTimestamp) }
  })
}

/** The close's 409 `open_orders` (ordenes-abiertas-caja S1): its message and count, or null for any other error. */
export function openOrdersConflictOf(error: unknown): { count: number; message: string } | null {
  const cause = error instanceof PaymentServiceError ? error.cause : error
  if (!(cause instanceof ApiError) || cause.status !== 409 || cause.body.code !== "open_orders") return null
  return { count: Number(cause.body.count), message: cause.message }
}

// ---- Payments ledger reads ---------------------------------------------------------------

/** Payments taken on these registers, tenders embedded, newest first. */
export function listRegisterPayments(registerIds: string[]): Promise<PaymentRow[]> {
  if (registerIds.length === 0) return Promise.resolve([])
  return call(async () => {
    const { data } = await api.GET("/api/payments", { params: { query: { cashRegisterIds: registerIds.join(",") } } })
    return required(data)
  })
}

/** Payments of these orders, tenders embedded, newest first. */
export function getPaymentsByOrderIds(orderIds: string[]): Promise<PaymentRow[]> {
  if (orderIds.length === 0) return Promise.resolve([])
  return call(async () => {
    const { data } = await api.GET("/api/payments", { params: { query: { orderIds: orderIds.join(",") } } })
    return required(data)
  })
}

/**
 * F1: voids a payment (always with a supervisor authorization, action
 * void_payment). It no longer counts in any total and the order is open again.
 * The ApiError is not turned into a PaymentServiceError, so `voidRefusalOf`
 * reads its `code` (authorization_required, payment_voided, register_closed...).
 */
export async function voidPayment(paymentId: string, body: Schemas["VoidPaymentRequest"]): Promise<Schemas["PaymentVoid"]> {
  const { data } = await api.POST("/api/payments/{id}/void", { ...byId(paymentId), body })
  return required(data)
}

export { PaymentServiceError } from "@/lib/payments/types"
export type { PaymentServiceErrorKind } from "@/lib/payments/types"
