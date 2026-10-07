/**
 * Shared types for the home-delivery module.
 *
 * Pure data: no Supabase, no DOM, no zustand. The client UI, the
 * optimistic state and the delivery-service all speak these shapes.
 *
 * Money is whole Colombian pesos (COP): no cents exist, so any
 * non-integer amount is a parsing or arithmetic bug and the compute
 * helpers reject it with a typed issue rather than rounding silently.
 *
 * Mirrors `lib/payments/types.ts` style and naming. The `kind`
 * namespace (`PaymentServiceError`/`DeliveryServiceError` etc.) is
 * intentionally reused: the supabase-js error-code -> kind contract
 * (42501 / P0002 / P0001 / 22023) is identical for the two services,
 * and a single error class with a clear `name` keeps every consumer
 * honest about where the failure came from.
 */

// -----------------------------------------------------------
// Lifecycle (mirrors the server CHECK on order_deliveries.delivery_status)
// -----------------------------------------------------------

export type DeliveryStatus =
  | 'received'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled'

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'received',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'failed',
  'cancelled',
]

// The six transitions set_delivery_status understands (kebab-case,
// mirrors the SQL function arg `p_action`).
export type DeliveryAction =
  | 'start_preparing'
  | 'mark_ready'
  | 'dispatch'
  | 'deliver'
  | 'fail'
  | 'cancel'

export const DELIVERY_ACTIONS: readonly DeliveryAction[] = [
  'start_preparing',
  'mark_ready',
  'dispatch',
  'deliver',
  'fail',
  'cancel',
]

// The four roles the migration names: kitchen marks preparing/ready,
// delivery_operator / admin handle every transition; cashier has no
// delivery privileges.
export type DeliveryRole = 'kitchen' | 'delivery_operator' | 'admin' | 'cashier'

export const DELIVERY_ROLES: readonly DeliveryRole[] = [
  'kitchen',
  'delivery_operator',
  'admin',
  'cashier',
]

// -----------------------------------------------------------
// Payment mode (mirrors the server CHECK on order_deliveries.payment_mode)
// -----------------------------------------------------------

export type PaymentMode = 'prepaid' | 'cash_on_delivery'

// -----------------------------------------------------------
// Registries
// -----------------------------------------------------------

export interface Customer {
  id: string
  phone: string
  name: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomerAddress {
  id: string
  customerId: string
  label: string | null
  addressLine: string
  neighborhood: string | null
  reference: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface Courier {
  id: string
  name: string
  phone: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// -----------------------------------------------------------
// Order delivery (the 1:1 mirror on public.order_deliveries)
// -----------------------------------------------------------

export interface DeliveryOrder {
  orderId: string
  customerId: string
  customerName: string
  customerPhone: string
  addressLine: string
  neighborhood: string | null
  addressReference: string | null
  deliveryFee: number
  paymentMode: PaymentMode
  /** Whole COP pesos, only set when paymentMode === 'cash_on_delivery'. */
  cashChangeFor: number | null
  courierId: string | null
  status: DeliveryStatus
  failureReason: string | null
  notes: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  failedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

/** Minimal order fields the operator board joins against. */
export interface DeliveryOrderSummary {
  delivery: DeliveryOrder
  /** orders.subtotal + tax + tip + delivery_fee; pre-computed for the UI. */
  amountDue: number
  /** orders.subtotal, server-side. */
  subtotal: number
  /** orders.tax, server-side. */
  tax: number
}

// -----------------------------------------------------------
// Service input shapes (camelCase, what callers speak)
// -----------------------------------------------------------

/**
 * `camelCase` mirror of the create_delivery_order JSON args. Either
 *   `{ id }` (existing customer) or `{ phone, name? }` (lookup by
 *   normalized phone; name updates the registry only when it differs).
 *
 * Same for `address`: `{ id }` (existing address; must belong to the
 * resolved customer) or a new address payload (save=false by default
 * so one-shot deliveries do not pollute the registry).
 */
export interface CreateDeliveryCustomerInput {
  id?: string
  phone?: string
  name?: string
}

export interface CreateDeliveryAddressInput {
  id?: string
  label?: string | null
  addressLine?: string
  neighborhood?: string | null
  reference?: string | null
  /** Persist to customer_addresses; defaults to false. */
  save?: boolean
}

export interface CreateDeliveryItemInput {
  dishId: string
  quantity: number
  comments?: string | null
}

export interface CreateDeliveryOrderInput {
  customer: CreateDeliveryCustomerInput
  address: CreateDeliveryAddressInput
  items: CreateDeliveryItemInput[]
  /** Whole COP pesos, non-negative. */
  deliveryFee: number
  paymentMode: PaymentMode
  /** Whole COP pesos, only allowed when paymentMode === 'cash_on_delivery'. */
  cashChangeFor?: number | null
  notes?: string | null
}

export interface CreateDeliveryOrderResult {
  orderId: string
  customerId: string
  /** NULL when the address was not saved or when the caller passed {id}. */
  addressId: string | null
  delivery: DeliveryOrder
}

/**
 * `camelCase` mirror of the set_delivery_status args. `courierId` is
 * required for `dispatch`; `reason` is required for `fail`.
 */
export interface SetDeliveryStatusInput {
  orderId: string
  action: DeliveryAction
  courierId?: string | null
  reason?: string | null
}

// -----------------------------------------------------------
// Service error
// -----------------------------------------------------------

/**
 * Typed error codes for the delivery service. The set is identical to
 * PaymentServiceErrorKind (supabase-js error-code -> kind contract is
 * shared across every service in this codebase: 42501 / P0002 /
 * P0001 / 22023 / 23505 / 23514 / unknown). Keeping a separate
 * DeliveryServiceError class with the same kinds keeps call sites
 * readable and lets log scrapers tell the two domains apart.
 */
export type DeliveryServiceErrorKind =
  | 'not-authorized'
  | 'not-found'
  | 'rejected'
  | 'invalid-input'
  | 'unknown'

export interface DeliveryServiceErrorInit {
  kind: DeliveryServiceErrorKind
  message: string
  /** Raw supabase-js error for callers that need the original shape. */
  cause?: unknown
}

/**
 * Delivery-service error wrapper. Same kind set as PaymentServiceError
 * (so a single `instanceof` check covers both kinds when the UI does
 * not care which domain failed), but with a distinct `name` so logs
 * and React error boundaries stay readable.
 */
export class DeliveryServiceError extends Error {
  readonly kind: DeliveryServiceErrorKind
  readonly cause?: unknown

  constructor(init: DeliveryServiceErrorInit) {
    super(init.message)
    this.name = 'DeliveryServiceError'
    this.kind = init.kind
    this.cause = init.cause
  }
}