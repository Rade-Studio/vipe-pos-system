/**
 * Delivery service: thin wrappers over the Supabase RPCs and the
 * `couriers` / `customers` / `customer_addresses` / `order_deliveries`
 * reads.
 *
 * The wire format is the migration's, NOT this file's:
 *   - `create_delivery_order(p_customer jsonb, p_address jsonb, p_items
 *     jsonb, p_delivery_fee bigint, p_payment_mode text, p_cash_change_for
 *     bigint DEFAULT NULL, p_notes text DEFAULT NULL)` returns jsonb.
 *   - `set_delivery_status(p_order_id uuid, p_action text, p_courier_id
 *     uuid DEFAULT NULL, p_reason text DEFAULT NULL)` returns jsonb.
 *
 * `supabase.rpc(...)` is invoked through `(supabase.rpc as any)` and
 * `(supabase as any).from(...)` because supabase-js does not type the
 * JSON overload for RPC args out of the box (the same pattern
 * `lib/supabase/payments-service.ts` uses).
 *
 * Every error is normalized to a `DeliveryServiceError` whose `kind`
 * is derived from the supabase-js `error.code` (42501, P0002, P0001,
 * 22023). The server's message is kept verbatim on `error.message` so
 * the UI can show "delivery is already in state X" without having to
 * map SQLSTATEs again.
 */

import { supabase } from '@/lib/supabase/client'
import {
  DeliveryServiceError,
} from '@/lib/delivery/types'
import type { DeliveryServiceErrorKind } from '@/lib/delivery/types'
import { normalizePhone } from '@/lib/delivery/phone'
import { toCourierPayload, validateCourierInput } from '@/lib/delivery/courier-admin'
import type { CourierInput } from '@/lib/delivery/courier-admin'
import {
  parseCourierRow,
  parseCreateDeliveryOrderResult,
  parseCustomerAddressRow,
  parseCustomerRow,
  parseOrderDeliveryRow,
} from '@/lib/delivery/parse'
import type {
  Courier,
  CreateDeliveryAddressInput,
  CreateDeliveryCustomerInput,
  CreateDeliveryItemInput,
  CreateDeliveryOrderInput,
  CreateDeliveryOrderResult,
  Customer,
  CustomerAddress,
  DeliveryOrder,
  PaymentMode,
} from '@/lib/delivery/types'

// -----------------------------------------------------------
// Supabase row + error types
// -----------------------------------------------------------

interface SupabaseLikeError {
  code?: string
  message?: string
  [k: string]: unknown
}

interface CustomerAddressWire {
  id: string
  customer_id: string
  label: string | null
  address_line: string
  neighborhood: string | null
  reference: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

interface CustomerWithAddresses {
  customer: Customer
  addresses: CustomerAddress[]
}

export interface DeliveryOrderWithBill {
  delivery: DeliveryOrder
  amountDue: number
  subtotal: number
  tax: number
  /** orders.status = 'paid': pay_order already settled the order. */
  isPaid: boolean
}

// -----------------------------------------------------------
// Error mapping
// -----------------------------------------------------------

/**
 * Map a supabase-js error code to a `DeliveryServiceErrorKind`. Same
 * mapping as `lib/supabase/payments-service.ts` because the
 * supabase-js error-code -> kind contract is shared across every
 * service in this codebase:
 *
 *   42501  not-authorized   caller has no profile, or role below the RPC's allow-list
 *   P0002  not-found        the only SQLSTATE that does not leak another tenant's row
 *   P0001  rejected         business-rule violation
 *   22023  invalid-input    bad shape (bad uuid, negative fee, bad phone)
 *   23505  rejected         unique_violation: same order twice on create_delivery_order
 *   23514  invalid-input    check_violation: a server CHECK rejected the row
 *
 * Anything else is `unknown`. The raw cause is preserved on
 * `DeliveryServiceError.cause` for log scraping.
 */
function mapErrorCode(code: string | undefined): DeliveryServiceErrorKind {
  switch (code) {
    case '42501':
      return 'not-authorized'
    case 'P0002':
      return 'not-found'
    case 'P0001':
      return 'rejected'
    case '22023':
      return 'invalid-input'
    case '23505':
      return 'rejected'
    case '23514':
      return 'invalid-input'
    default:
      return 'unknown'
  }
}

function wrapError(error: SupabaseLikeError | null | undefined): DeliveryServiceError {
  const code = error?.code
  const message = error?.message ?? 'Supabase request failed'
  return new DeliveryServiceError({
    kind: mapErrorCode(code),
    message,
    cause: error ?? undefined,
  })
}

function wrapParseError(rpc: string, parseErr: unknown): DeliveryServiceError {
  return new DeliveryServiceError({
    kind: 'unknown',
    message: `${rpc} returned a malformed payload: ${(parseErr as Error).message}`,
    cause: parseErr,
  })
}

/** A successful RPC must return its row; a missing key field is a failure. */
function requireData<T>(data: unknown, rpc: string, key: string): T {
  if (data === null || typeof data !== 'object' || !(key in data)) {
    throw new DeliveryServiceError({
      kind: 'unknown',
      message: `${rpc} returned no data`,
    })
  }
  return data as T
}

// -----------------------------------------------------------
// findCustomerByPhone
// -----------------------------------------------------------

/**
 * Look up the customer by the operator-typed phone number, returning
 * the customer row plus their saved addresses. Empty / unparseable
 * input short-circuits with `invalid-input` so the operator form
 * never fires a network request for a half-typed number.
 *
 * The phone is normalised with `normalizePhone` (strips `+57` when
 * the remainder is a 10-digit Colombian mobile) so the same registry
 * row is found whether the operator typed `+57 310 123 4567`,
 * `573101234567` or `3101234567`. When the customer has no rows yet
 * the second query is still issued (the customer's addresses are
 * the same list the operator form will populate) and the caller
 * gets `customer + []`.
 */
export async function findCustomerByPhone(
  phone: string,
): Promise<CustomerWithAddresses | null> {
  const normalized = normalizePhone(phone)
  if (normalized === null) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'findCustomerByPhone: phone must be a 7..15 digit string',
    })
  }

  const { data, error } = await (supabase as any)
    .from('customers')
    .select('id, phone, name, notes, created_at, updated_at')
    .eq('phone', normalized)
    .maybeSingle()

  if (error) throw wrapError(error)
  if (data === null) return null

  let customer: Customer
  try {
    customer = parseCustomerRow(data)
  } catch (parseErr) {
    throw wrapParseError('findCustomerByPhone', parseErr)
  }

  const { data: addrData, error: addrErr } = await (supabase as any)
    .from('customer_addresses')
    .select('id, customer_id, label, address_line, neighborhood, reference, is_default, created_at, updated_at')
    .eq('customer_id', customer.id)
    .order('is_default', { ascending: false })

  if (addrErr) throw wrapError(addrErr)

  let addresses: CustomerAddress[]
  try {
    addresses = ((addrData ?? []) as unknown[]).map((row) => parseCustomerAddressRow(row))
  } catch (parseErr) {
    throw wrapParseError('findCustomerByPhone(addresses)', parseErr)
  }

  return { customer, addresses }
}

// -----------------------------------------------------------
// listCouriers
// -----------------------------------------------------------

/**
 * Read the per-tenant courier registry ordered by name.
 *
 * `activeOnly: true` adds an `is_active = true` filter (the dispatch
 * dialog picker). `activeOnly: false` returns every row so historical
 * deliveries still resolve the courier they used even after a soft
 * delete.
 */
export async function listCouriers(options: { activeOnly: boolean }): Promise<Courier[]> {
  let chain = (supabase as any)
    .from('couriers')
    .select('id, name, phone, is_active, created_at, updated_at')
    .order('name', { ascending: true })
  if (options.activeOnly) chain = chain.eq('is_active', true)

  const { data, error } = await chain
  if (error) throw wrapError(error)

  try {
    return ((data ?? []) as unknown[]).map((row) => parseCourierRow(row))
  } catch (parseErr) {
    throw wrapParseError('listCouriers', parseErr)
  }
}

// -----------------------------------------------------------
// createCourier / updateCourier
// -----------------------------------------------------------

const COURIER_COLUMNS = 'id, name, phone, is_active, created_at, updated_at'

function courierInputError(rpc: string, errors: string[]): DeliveryServiceError {
  return new DeliveryServiceError({
    kind: 'invalid-input',
    message: `${rpc}: ${errors.join('; ')}`,
  })
}

function parseCourierWrite(data: unknown, rpc: string): Courier {
  try {
    return parseCourierRow(data)
  } catch (parseErr) {
    throw wrapParseError(rpc, parseErr)
  }
}

/**
 * Insert a courier (admin only; RLS raises 42501 for any other role).
 * `restaurant_id` is defaulted server-side to the caller's tenant.
 */
export async function createCourier(input: CourierInput): Promise<Courier> {
  const errors = validateCourierInput(input)
  if (errors.length > 0) throw courierInputError('createCourier', errors)

  const { data, error } = await (supabase as any)
    .from('couriers')
    .insert(toCourierPayload(input))
    .select(COURIER_COLUMNS)
    .single()

  if (error) throw wrapError(error)
  return parseCourierWrite(data, 'createCourier')
}

export interface UpdateCourierInput {
  name?: string
  phone?: string
  isActive?: boolean
}

/**
 * Patch name, phone and/or is_active on one courier (admin only).
 * There is no delete: deactivating keeps historical deliveries
 * resolving the courier. A blank phone clears it. An UPDATE that
 * matches no visible row comes back as PGRST116 from `.single()`
 * and is reported as `not-found`.
 */
export async function updateCourier(id: string, input: UpdateCourierInput): Promise<Courier> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined || input.phone !== undefined) {
    // Absent fields get a valid stand-in so only the supplied ones can fail.
    const candidate = { name: input.name ?? 'x', phone: input.phone ?? '' }
    const errors = validateCourierInput(candidate)
    if (errors.length > 0) throw courierInputError('updateCourier', errors)
    const payload = toCourierPayload(candidate)
    if (input.name !== undefined) patch.name = payload.name
    if (input.phone !== undefined) patch.phone = payload.phone
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive
  if (Object.keys(patch).length === 0) {
    throw courierInputError('updateCourier', ['patch must not be empty'])
  }

  const { data, error } = await (supabase as any)
    .from('couriers')
    .update(patch)
    .eq('id', id)
    .select(COURIER_COLUMNS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      throw new DeliveryServiceError({
        kind: 'not-found',
        message: 'updateCourier: courier not found',
        cause: error,
      })
    }
    throw wrapError(error)
  }
  return parseCourierWrite(data, 'updateCourier')
}

// -----------------------------------------------------------
// createDeliveryOrder
// -----------------------------------------------------------

/**
 * CamelCase -> snake_case adapter for `p_customer`. Either `{id}` or
 * `{phone, name?}` is forwarded verbatim; the server-side CHECK on
 * the `?:` shape rejects both-neither and both-fields.
 */
function customerWire(input: CreateDeliveryCustomerInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.id !== undefined) out.id = input.id
  if (input.phone !== undefined) out.phone = input.phone
  if (input.name !== undefined) out.name = input.name
  return out
}

/**
 * CamelCase -> snake_case adapter for `p_address`. Existing-address
 * lookups forward `{id}`; new addresses forward
 * `{address_line, neighborhood?, reference?, label?, save?}`.
 */
function addressWire(input: CreateDeliveryAddressInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.id !== undefined) out.id = input.id
  if (input.addressLine !== undefined) out.address_line = input.addressLine
  if (input.neighborhood !== undefined) out.neighborhood = input.neighborhood
  if (input.reference !== undefined) out.reference = input.reference
  if (input.label !== undefined) out.label = input.label
  if (input.save !== undefined) out.save = input.save
  return out
}

/**
 * CamelCase -> snake_case adapter for `p_items`. Quantity stays
 * integer; comments is trimmed to undefined so the server's btrim
 * NULL-mapping runs on empty values.
 */
function itemsWire(items: CreateDeliveryItemInput[]): Array<Record<string, unknown>> {
  return items.map((it) => {
    const out: Record<string, unknown> = {
      dish_id: it.dishId,
      quantity: it.quantity,
    }
    if (it.comments !== undefined) out.comments = it.comments
    return out
  })
}

function validateCreateDeliveryInput(input: CreateDeliveryOrderInput): void {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'createDeliveryOrder: items must be a non-empty array',
    })
  }
  if (!Number.isInteger(input.deliveryFee) || input.deliveryFee < 0) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'createDeliveryOrder: deliveryFee must be a non-negative integer',
    })
  }
  if (input.paymentMode !== 'prepaid' && input.paymentMode !== 'cash_on_delivery') {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'createDeliveryOrder: paymentMode must be "prepaid" | "cash_on_delivery"',
    })
  }
  // Schema CHECK: cash_change_for is only allowed for cash_on_delivery.
  if (input.paymentMode === 'prepaid' && input.cashChangeFor != null) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'createDeliveryOrder: cashChangeFor must be null when paymentMode is "prepaid"',
    })
  }
  if (
    input.cashChangeFor != null &&
    (!Number.isInteger(input.cashChangeFor) || input.cashChangeFor < 0)
  ) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'createDeliveryOrder: cashChangeFor must be a non-negative integer when set',
    })
  }
}

/**
 * Atomic delivery-order intake. Builds the JSONB the server expects,
 * forwards the exact snake_case arg names the migration defines, and
 * parses the JSONB response back to the camelCase client shape.
 *
 * Pre-flight input validation is local (cheap shape checks that the
 * server would also enforce, but cheaper than a round-trip on a
 * half-filled operator form). The server is the source of truth
 * for every other rule (uniqueness, RLS, tenant scoping).
 */
export async function createDeliveryOrder(
  input: CreateDeliveryOrderInput,
): Promise<CreateDeliveryOrderResult> {
  validateCreateDeliveryInput(input)

  const { data, error } = await (supabase.rpc as any)('create_delivery_order', {
    p_customer: customerWire(input.customer),
    p_address: addressWire(input.address),
    p_items: itemsWire(input.items),
    p_delivery_fee: input.deliveryFee,
    p_payment_mode: input.paymentMode as PaymentMode,
    p_cash_change_for:
      input.paymentMode === 'cash_on_delivery' ? input.cashChangeFor ?? null : null,
    p_notes: input.notes ?? null,
  })

  if (error) throw wrapError(error)

  const raw = requireData<unknown>(data, 'create_delivery_order', 'order_id')
  try {
    return parseCreateDeliveryOrderResult(raw)
  } catch (parseErr) {
    throw wrapParseError('create_delivery_order', parseErr)
  }
}

// -----------------------------------------------------------
// setDeliveryStatus
// -----------------------------------------------------------

/**
 * Client-side rejection of status-only actions that need extra input
 * the server would otherwise reject with 22023. Cheap shape checks
 * so the operator form does not burn a round-trip on obvious typos.
 */
function validateSetStatusInput(input: {
  orderId: string
  action: string
  courierId?: string | null
  reason?: string | null
}): void {
  if (!input.orderId) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'setDeliveryStatus: orderId must not be empty',
    })
  }
  const trimmedReason = (input.reason ?? '').trim()
  if (input.action === 'fail') {
    if (trimmedReason.length === 0) {
      throw new DeliveryServiceError({
        kind: 'invalid-input',
        message: 'setDeliveryStatus: fail requires a non-empty reason',
      })
    }
    if (trimmedReason.length > 200) {
      throw new DeliveryServiceError({
        kind: 'invalid-input',
        message: 'setDeliveryStatus: fail reason must be <= 200 characters',
      })
    }
  }
  if (input.action === 'dispatch' && !input.courierId) {
    throw new DeliveryServiceError({
      kind: 'invalid-input',
      message: 'setDeliveryStatus: dispatch requires a courierId',
    })
  }
}

/**
 * Atomic lifecycle transition. Locks the order_deliveries row on the
 * server (FOR UPDATE), enforces the role matrix, validates the
 * per-action extras (courierId on dispatch, reason on fail), and
 * returns the updated row.
 *
 * Same-state replays raise P0001 ('delivery is already in state X')
 * on the server; the UI distinguishes "I already moved this" from
 * "the server refused" through a single error path. cancel-after-
 * pay raises P0001 too; refunds are out of scope.
 */
export async function setDeliveryStatus(
  input: {
    orderId: string
    action: 'start_preparing' | 'mark_ready' | 'dispatch' | 'deliver' | 'fail' | 'cancel'
    courierId?: string | null
    reason?: string | null
  },
): Promise<DeliveryOrder> {
  validateSetStatusInput(input)

  const { data, error } = await (supabase.rpc as any)('set_delivery_status', {
    p_order_id: input.orderId,
    p_action: input.action,
    p_courier_id: input.courierId ?? null,
    p_reason: input.reason ?? null,
  })

  if (error) throw wrapError(error)

  const raw = requireData<unknown>(data, 'set_delivery_status', 'order_id')
  try {
    return parseOrderDeliveryRow(raw)
  } catch (parseErr) {
    throw wrapParseError('set_delivery_status', parseErr)
  }
}

// -----------------------------------------------------------
// listActiveDeliveries
// -----------------------------------------------------------

/**
 * Read every non-terminal delivery in the tenant, plus the terminal
 * (delivered / cancelled) rows that landed today. The operator
 * board uses the same read so a recently-closed delivery stays
 * visible until the end of the shift, but yesterday's closed rows
 * do not clog the board.
 *
 * The server enforces the role matrix (admin / cashier /
 * delivery_operator / kitchen can SELECT order_deliveries; kitchen
 * cannot read customers / customer_addresses). The `today_iso`
 * boundary is computed client-side for the local date the operator
 * sees; the server has no notion of "today" beyond `now()`.
 */
export async function listActiveDeliveries(): Promise<DeliveryOrderWithBill[]> {
  const todayIso = startOfTodayIso()

  const { data, error } = await (supabase as any)
    .from('order_deliveries')
    .select(
      'order_id, restaurant_id, customer_id, customer_name, customer_phone, address_line, neighborhood, address_reference, delivery_fee, payment_mode, cash_change_for, courier_id, delivery_status, failure_reason, notes, dispatched_at, delivered_at, failed_at, cancelled_at, created_at, updated_at, orders!inner(id, subtotal, tax, tip, total, status)',
    )
    .or(
      // Every non-terminal state OR anything updated since local midnight,
      // which keeps terminal-yesterday out without an extra round-trip.
      // PostgREST rejects function-style `not(and(...))` (PGRST100), so this
      // is the De Morgan form of `NOT (terminal AND updated_at < today)`.
      `delivery_status.not.in.(delivered,cancelled),updated_at.gte.${todayIso}`,
    )
    .order('updated_at', { ascending: false })

  if (error) throw wrapError(error)
  if (!data || (Array.isArray(data) && data.length === 0)) return []

  try {
    return (data as unknown[]).map((row) => parseActiveDeliveryRow(row))
  } catch (parseErr) {
    throw wrapParseError('listActiveDeliveries', parseErr)
  }
}

/**
 * YYYY-MM-DDTHH:MM:SS.sssZ for the local midnight. The operator's
 * "today" is the wall-clock day, so we walk the offset from UTC.
 * The PostgREST `or` filter accepts an ISO timestamp verbatim.
 */
function startOfTodayIso(): string {
  const now = new Date()
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return localMidnight.toISOString()
}

function parseActiveDeliveryRow(raw: unknown): DeliveryOrderWithBill {
  const obj = (raw ?? null) as Record<string, unknown> | null
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('listActiveDeliveries: row must be an object')
  }
  const delivery = parseOrderDeliveryRow(obj)
  const ordersRaw = obj.orders
  if (ordersRaw === null || typeof ordersRaw !== 'object' || Array.isArray(ordersRaw)) {
    throw new Error('listActiveDeliveries: orders must be an object')
  }
  const orders = ordersRaw as Record<string, unknown>
  const subtotal = Number(orders.subtotal)
  const tax = Number(orders.tax)
  const total = Number(orders.total)
  if (!Number.isInteger(subtotal) || !Number.isInteger(tax) || !Number.isInteger(total)) {
    throw new Error(
      `listActiveDeliveries: orders subtotal/tax/total must be whole COP pesos; got ${orders.subtotal}/${orders.tax}/${orders.total}`,
    )
  }
  // amountDue mirrors orders.total = subtotal + tax (NO delivery fee).
  // The delivery fee is rendered separately from `delivery.deliveryFee`
  // so the operator board keeps the food line distinct from the
  // courier line, matching the kitchen-ticket layout. The fee is
  // added to amount_due inside pay_order; this read is the bill
  // preview, not the checkout total.
  const amountDue = subtotal + tax
  if (typeof orders.status !== 'string') {
    throw new Error(`listActiveDeliveries: orders.status must be a string; got ${JSON.stringify(orders.status)}`)
  }
  const isPaid = orders.status === 'paid'
  return { delivery, amountDue, subtotal, tax, isPaid }
}

// -----------------------------------------------------------
// Re-exports
// -----------------------------------------------------------

export { DeliveryServiceError } from '@/lib/delivery/types'
export type { DeliveryServiceErrorKind } from '@/lib/delivery/types'

// Type touch so a future refactor that drops the registry wire
// import surfaces it as a TS error rather than a silent dead branch.
export type _TouchCustomerAddressWire = CustomerAddressWire