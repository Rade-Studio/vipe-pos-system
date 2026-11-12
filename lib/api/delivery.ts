import { api } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { components } from "@/lib/api/schema"
import { toCourierPayload, validateCourierInput } from "@/lib/delivery/courier-admin"
import type { CourierInput } from "@/lib/delivery/courier-admin"
import { normalizeCourierLocation } from "@/lib/delivery/dispatch-details"
import { normalizePhone } from "@/lib/delivery/phone"
import type { DeliveryBoardRow } from "@/lib/delivery/realtime"
import { DeliveryServiceError } from "@/lib/delivery/types"
import type {
  ClosedTodaySummary,
  Courier,
  CreateDeliveryOrderInput,
  Customer,
  CustomerAddress,
  CustomerHistory,
  DeliveryAction,
  DeliveryOrder,
  DeliveryServiceErrorKind,
} from "@/lib/delivery/types"

/**
 * Delivery through the API (T11, S3, S4): customers, couriers, the
 * transactional `POST /delivery/orders` (create_delivery_order +
 * consume_order_stock + the kitchen command job in ONE server transaction)
 * and the status actions over `set_delivery_status`. Same exported names as
 * the Supabase service it replaces.
 *
 * Client checks here are UX only (no round-trip for a half-filled form); the
 * server is authoritative. Every failure becomes a `DeliveryServiceError`
 * (see `deliveryErrorOf`) whose message is the server's, verbatim, so
 * `lib/delivery/card-actions.ts` can match it.
 */

type Schemas = components["schemas"]

export interface CustomerWithAddresses {
  customer: Customer
  addresses: CustomerAddress[]
  /** Optional for callers that build one by hand; the API always sends it. */
  history?: CustomerHistory
}

/** One row of the operator board: the delivery plus the bill of its order. */
export type DeliveryOrderWithBill = DeliveryBoardRow

/** The created order, its stock consumption (shortages kept) and the kitchen job. */
export type CreateDeliveryOrderResult = Schemas["CreateDeliveryOrderResult"]

/**
 * The generated DTOs must stay assignable to the domain shapes the screens
 * use: a contract change that breaks one fails the typecheck here.
 */
const asDelivery = (dto: Schemas["DeliveryOrder"]): DeliveryOrder => dto
const asBoardRow = (dto: Schemas["DeliveryOrderWithBill"]): DeliveryOrderWithBill => dto
const asCourier = (dto: Schemas["Courier"]): Courier => dto
const asCustomer = (dto: Schemas["CustomerWithAddresses"]): CustomerWithAddresses => dto
const asClosedToday = (dto: Schemas["ClosedTodaySummary"]): ClosedTodaySummary => dto

export interface UpdateCourierInput {
  name?: string
  phone?: string
  isActive?: boolean
}

// ---- Errors -------------------------------------------------------------------

/**
 * SQLSTATE -> kind. The API error body carries the SQLSTATE in `code` for
 * database-originated 4xx:
 *
 *   42501        not-authorized  role outside the RPC's allow-list
 *   P0002        not-found       missing customer/address/dish/delivery (no cross-tenant leak)
 *   P0001/23505  rejected        business rule / same order twice
 *   22023/23514  invalid-input   bad parameter / CHECK constraint
 */
const KIND_BY_CODE: Record<string, DeliveryServiceErrorKind> = {
  "42501": "not-authorized",
  P0002: "not-found",
  P0001: "rejected",
  "23505": "rejected",
  "22023": "invalid-input",
  "23514": "invalid-input",
}

/**
 * Any error -> `DeliveryServiceError`. With a `code` the SQLSTATE decides;
 * without one, a 422 is the API's own validation (zod) -> invalid-input, a
 * 409 an API conflict -> rejected, a 401/403 the role guard -> not-authorized
 * and a 404 a missing row (`Courier not found`) -> not-found. Anything else is
 * unknown; the original error is the `cause`.
 */
export function deliveryErrorOf(error: unknown): DeliveryServiceError {
  if (error instanceof DeliveryServiceError) return error
  if (error instanceof ApiError) {
    const code = typeof error.body.code === "string" ? error.body.code : undefined
    const kind: DeliveryServiceErrorKind = code
      ? (KIND_BY_CODE[code] ?? "unknown")
      : error.status === 422
        ? "invalid-input"
        : error.status === 409
          ? "rejected"
          : error.status === 403 || error.status === 401
            ? "not-authorized"
            : error.status === 404
              ? "not-found"
              : "unknown"
    return new DeliveryServiceError({ kind, message: error.message, cause: error })
  }
  const message = error instanceof Error ? error.message : "Delivery request failed"
  return new DeliveryServiceError({ kind: "unknown", message, cause: error })
}

const invalid = (message: string) => new DeliveryServiceError({ kind: "invalid-input", message })

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined, what: string): T {
  if (data === undefined) throw new DeliveryServiceError({ kind: "unknown", message: `${what} returned no data` })
  return data
}

async function call<T>(what: string, request: () => Promise<{ data?: T }>): Promise<T> {
  try {
    return required((await request()).data, what)
  } catch (error) {
    throw deliveryErrorOf(error)
  }
}

// ---- Customers ----------------------------------------------------------------

/**
 * The customer registered with this phone plus their addresses (default
 * first), or `null` when the API answers 404 (no customer yet). The phone is
 * normalised like the server does; an unparseable one never leaves the client.
 */
/** The API's own "no customer with this phone"; a proxy 404 is a real failure. */
const isNoCustomer = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 404 &&
  error.body.code === undefined &&
  error.message === "Customer not found"

export async function findCustomerByPhone(phone: string): Promise<CustomerWithAddresses | null> {
  const normalized = normalizePhone(phone)
  if (normalized === null) throw invalid("findCustomerByPhone: phone must be a 7..15 digit string")
  try {
    const { data } = await api.GET("/api/delivery/customers", { params: { query: { phone: normalized } } })
    return asCustomer(required(data, "findCustomerByPhone"))
  } catch (error) {
    if (isNoCustomer(error)) return null
    throw deliveryErrorOf(error)
  }
}

// ---- Couriers -----------------------------------------------------------------

/** The courier registry by name; `activeOnly` for the dispatch picker. */
export async function listCouriers(options: { activeOnly: boolean }): Promise<Courier[]> {
  const rows = await call("listCouriers", () =>
    api.GET("/api/delivery/couriers", {
      params: { query: { activeOnly: options.activeOnly ? "true" : "false" } },
    }),
  )
  return rows.map(asCourier)
}

/** Admin or delivery operator (403 otherwise). Name trimmed, phone normalised or null. */
export async function createCourier(input: CourierInput): Promise<Courier> {
  const errors = validateCourierInput(input)
  if (errors.length > 0) throw invalid(`createCourier: ${errors.join("; ")}`)
  const body = toCourierPayload(input)
  return asCourier(await call("createCourier", () => api.POST("/api/delivery/couriers", { body })))
}

/**
 * Patch name, phone and/or isActive. Admins patch every field; a delivery
 * operator only isActive (403 otherwise, T19). There is no delete:
 * deactivating keeps historical deliveries resolving the courier. A blank
 * phone clears it.
 */
export async function updateCourier(id: string, input: UpdateCourierInput): Promise<Courier> {
  const body: { name?: string; phone?: string | null; isActive?: boolean } = {}
  if (input.name !== undefined || input.phone !== undefined) {
    // Absent fields get a valid stand-in so only the supplied ones can fail.
    const candidate = { name: input.name ?? "x", phone: input.phone ?? "" }
    const errors = validateCourierInput(candidate)
    if (errors.length > 0) throw invalid(`updateCourier: ${errors.join("; ")}`)
    const payload = toCourierPayload(candidate)
    if (input.name !== undefined) body.name = payload.name
    if (input.phone !== undefined) body.phone = payload.phone
  }
  if (input.isActive !== undefined) body.isActive = input.isActive
  if (Object.keys(body).length === 0) throw invalid("updateCourier: patch must not be empty")
  return asCourier(
    await call("updateCourier", () => api.PATCH("/api/delivery/couriers/{id}", { params: { path: { id } }, body })),
  )
}

// ---- Orders -------------------------------------------------------------------

function validateCreateDeliveryInput(input: CreateDeliveryOrderInput): void {
  if (!Array.isArray(input.items) || input.items.length + (input.combos?.length ?? 0) === 0) {
    throw invalid("createDeliveryOrder: items and combos must not both be empty")
  }
  if (!Number.isInteger(input.deliveryFee) || input.deliveryFee < 0) {
    throw invalid("createDeliveryOrder: deliveryFee must be a non-negative integer")
  }
  if (input.paymentMode !== "prepaid" && input.paymentMode !== "cash_on_delivery") {
    throw invalid('createDeliveryOrder: paymentMode must be "prepaid" | "cash_on_delivery"')
  }
  if (input.paymentMode === "prepaid" && input.cashChangeFor != null) {
    throw invalid('createDeliveryOrder: cashChangeFor must be null when paymentMode is "prepaid"')
  }
  if (input.paymentMode !== "prepaid" && input.prepaidMethodId != null) {
    throw invalid('createDeliveryOrder: prepaidMethodId is only allowed when paymentMode is "prepaid"')
  }
  if (input.cashChangeFor != null && (!Number.isInteger(input.cashChangeFor) || input.cashChangeFor < 0)) {
    throw invalid("createDeliveryOrder: cashChangeFor must be a non-negative integer when set")
  }
}

/**
 * ONE request: the server creates the order, consumes its stock (a shortage
 * keeps the order and comes back in `consumption.shortages`) and enqueues the
 * kitchen command; any other failure rolls all three back.
 */
export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<CreateDeliveryOrderResult> {
  validateCreateDeliveryInput(input)
  const body = {
    customer: input.customer,
    address: input.address,
    items: input.items,
    deliveryFee: input.deliveryFee,
    paymentMode: input.paymentMode,
    cashChangeFor: input.paymentMode === "cash_on_delivery" ? (input.cashChangeFor ?? null) : null,
    notes: input.notes ?? null,
    // Sent only when chosen, so the old body stays byte-identical.
    ...(input.prepaidMethodId != null ? { prepaidMethodId: input.prepaidMethodId } : {}),
    // Combos (S7) also only when there are any.
    ...(input.combos?.length ? { combos: input.combos } : {}),
  }
  return call("createDeliveryOrder", () => api.POST("/api/delivery/orders", { body }))
}

/**
 * One lifecycle transition through `set_delivery_status`; the role matrix,
 * the courier and the reason are the server's to enforce. A same-state replay
 * comes back as `rejected` with the server's message.
 */
export async function setDeliveryStatus(input: {
  orderId: string
  action: DeliveryAction
  courierId?: string | null
  reason?: string | null
  /** Only with dispatch (T19): ISO instant after now, within 6 hours. */
  courierEta?: string | null
  /** Only with dispatch (T19): trimmed 1..60 characters; blank is not sent. */
  courierLocation?: string | null
}): Promise<DeliveryOrder> {
  if (!input.orderId) throw invalid("setDeliveryStatus: orderId must not be empty")
  const reason = (input.reason ?? "").trim()
  if (input.action === "fail" && reason.length === 0) throw invalid("setDeliveryStatus: fail requires a non-empty reason")
  if (input.action === "fail" && reason.length > 200) {
    throw invalid("setDeliveryStatus: fail reason must be <= 200 characters")
  }
  if (input.action === "dispatch" && !input.courierId) throw invalid("setDeliveryStatus: dispatch requires a courierId")
  if (input.action !== "dispatch" && (input.courierEta != null || input.courierLocation != null)) {
    throw invalid("setDeliveryStatus: courierEta and courierLocation are only allowed with dispatch")
  }
  let courierLocation: string | null
  try {
    courierLocation = normalizeCourierLocation(input.courierLocation)
  } catch {
    throw invalid("setDeliveryStatus: courierLocation must be 1..60 characters")
  }
  // The ETA and location keys are sent only when captured, so the old body stays identical.
  const body = {
    action: input.action,
    courierId: input.courierId ?? null,
    reason: input.reason ?? null,
    ...(input.courierEta != null ? { courierEta: input.courierEta } : {}),
    ...(courierLocation !== null ? { courierLocation } : {}),
  }
  const row = await call("setDeliveryStatus", () =>
    api.POST("/api/delivery/orders/{id}/status", { params: { path: { id: input.orderId } }, body }),
  )
  return asDelivery(row)
}

/**
 * F3b: the audited cancellation (cancel_order, the same path as F1). A reason
 * is always required; `authorizationId` (POST /auth/authorize, cancel_order,
 * this order) only when the delivery is paid, and its payment is voided with
 * it. A refusal is the ApiError with its `code` (voidRefusalOf).
 */
export async function cancelDelivery(orderId: string, body: Schemas["CancelOrderRequest"]): Promise<DeliveryOrder> {
  const { data } = await api.POST("/api/delivery/orders/{id}/cancel", { params: { path: { id: orderId } }, body })
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return asDelivery(data)
}

/**
 * The courier is back at the restaurant (`return_courier`): a delivered or
 * failed delivery, once; the server's rejection comes back verbatim.
 */
export async function returnCourier(orderId: string): Promise<DeliveryOrder> {
  if (!orderId) throw invalid("returnCourier: orderId must not be empty")
  const row = await call("returnCourier", () =>
    api.POST("/api/delivery/orders/{id}/return", { params: { path: { id: orderId } } }),
  )
  return asDelivery(row)
}

/** "Cerrados hoy": delivered, cancelled and failed counts and the average delivery minutes. */
export async function getClosedTodaySummary(): Promise<ClosedTodaySummary> {
  return asClosedToday(await call("getClosedTodaySummary", () => api.GET("/api/delivery/closed-today")))
}

/**
 * The operator board: open deliveries plus those delivered or cancelled today
 * ("today" in the restaurant timezone, computed by the server).
 */
export async function listActiveDeliveries(): Promise<DeliveryOrderWithBill[]> {
  const rows = await call("listActiveDeliveries", () => api.GET("/api/delivery/active"))
  return rows.map(asBoardRow)
}

export { DeliveryServiceError } from "@/lib/delivery/types"
export type { DeliveryServiceErrorKind } from "@/lib/delivery/types"
