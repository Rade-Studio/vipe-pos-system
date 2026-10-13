/**
 * Order-draft reducer + helpers for the delivery operator's
 * "Nuevo domicilio" flow.
 *
 * Pure data: no Supabase, no DOM, no zustand. The view layer feeds
 * the `findCustomerByPhone` result into `setLookup` and drives the
 * form with `orderDraftReducer`. `validateDraft` is the single
 * source of truth for "submit enabled" + per-field Spanish error
 * messages. `toCreateInput` translates the draft to the exact wire
 * shape `createDeliveryOrder` expects.
 *
 * Money is whole Colombian pesos (COP); the reducer rejects
 * non-integer / negative fee and `cashChangeFor` so a UI bug cannot
 * reach `validateCreateDeliveryInput` on the service with garbage.
 * `draftTotals` rounds the tax (Math.round) so the dialog never
 * surfaces cents; the server recomputes the authoritative total
 * on `create_delivery_order`.
 *
 * Mirrors `lib/payments/draft.ts` style (pure reducer + helpers,
 * Vitest node-only) so the test discipline and naming stay aligned
 * with the rest of `lib/delivery`.
 */

import { normalizePhone } from './phone'
import type {
  CreateDeliveryAddressInput,
  CreateDeliveryCustomerInput,
  CreateDeliveryItemInput,
  CreateDeliveryOrderInput,
  Customer,
  CustomerAddress,
} from './types'

// -----------------------------------------------------------
// State
// -----------------------------------------------------------

/** A lookup result the operator's "Buscar" action produced. */
export type CustomerLookup =
  | { kind: 'none'; phone: string }
  | { kind: 'new'; phone: string }
  | {
      kind: 'existing'
      customer: Customer
      addresses: CustomerAddress[]
      /** The pre-selected address (server says is_default=true wins, otherwise first). */
      defaultAddressId: string
    }

/** A single line on the operator's cart. */
export interface CartLine {
  /** Stable id for the reducer's increment/decrement/remove/setComments. */
  id: string
  dishId: string
  name: string
  unitPrice: number
  quantity: number
  comments: string | null
}

/** The address half of the draft. */
export type AddressChoice =
  | { kind: 'none' }
  | { kind: 'existing'; addressId: string }
  | {
      kind: 'new'
      addressLine: string
      neighborhood: string | null
      reference: string | null
      label: string | null
      save: boolean
    }

export interface OrderDraft {
  phoneInput: string
  lookup: CustomerLookup
  customerName: string
  addressChoice: AddressChoice
  cartLines: CartLine[]
  fee: number
  paymentMode: 'prepaid' | 'cash_on_delivery'
  cashChangeFor: number | null
  notes: string | null
}

// -----------------------------------------------------------
// Actions
// -----------------------------------------------------------

export type OrderDraftAction =
  | { type: 'setPhoneInput'; value: string }
  | { type: 'setLookup'; lookup: CustomerLookup }
  | { type: 'setCustomerName'; value: string }
  | { type: 'setAddressExisting'; addressId: string }
  | {
      type: 'setAddressNew'
      addressLine: string
      neighborhood: string | null
      reference: string | null
      label: string | null
    }
  | { type: 'setAddressSave'; value: boolean }
  | {
      type: 'addItem'
      line: {
        dishId: string
        name: string
        unitPrice: number
        quantity: number
        comments: string | null
      }
    }
  | { type: 'incrementItem'; lineId: string }
  | { type: 'decrementItem'; lineId: string }
  | { type: 'removeItem'; lineId: string }
  | { type: 'setItemComments'; lineId: string; comments: string | null }
  | { type: 'setFee'; value: number }
  | { type: 'setPaymentMode'; value: 'prepaid' | 'cash_on_delivery' }
  | { type: 'setCashChangeFor'; value: number | null }
  | { type: 'setNotes'; value: string | null }
  | { type: 'reset'; suggestedFee: number }

// -----------------------------------------------------------
// Public factories
// -----------------------------------------------------------

export interface InitialOrderDraftInput {
  /** Whole COP pesos, >= 0. Comes from `business_config.delivery_default_fee` when present (task 7), else 0. */
  suggestedFee: number
}

function assertWholeNonNegativeFee(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`initialOrderDraft: suggestedFee must be a finite integer; received: ${value}`)
  }
  if (value < 0) {
    throw new RangeError(`initialOrderDraft: suggestedFee must be >= 0; received: ${value}`)
  }
  return value
}

/**
 * Build a fresh draft. Fee is preloaded from the caller-supplied
 * suggested value (the operator can edit it before submit).
 * Everything else starts empty so the operator form is idempotent
 * across re-opens.
 */
export function initialOrderDraft(input: InitialOrderDraftInput): OrderDraft {
  return {
    phoneInput: '',
    lookup: { kind: 'none', phone: '' },
    customerName: '',
    addressChoice: { kind: 'none' },
    cartLines: [],
    fee: assertWholeNonNegativeFee(input.suggestedFee),
    paymentMode: 'cash_on_delivery',
    cashChangeFor: null,
    notes: null,
  }
}

// -----------------------------------------------------------
// Reducer
// -----------------------------------------------------------

/**
 * Stable id for a cart line so the reducer's by-id actions stay
 * O(1). Client-side only (the wire shape uses dishId + comments).
 */
function newLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `line-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

/**
 * Append-or-merge for cart lines: same dishId + same comments
 * increments the existing quantity; otherwise a new line is added.
 * Comments === null is treated as "no comments" so the merge is
 * robust to the form having an empty string vs. a real null.
 */
function mergeCartLine(lines: CartLine[], incoming: Omit<CartLine, 'id'>): CartLine[] {
  const sameKey = (a: CartLine, b: { dishId: string; comments: string | null }) =>
    a.dishId === b.dishId && (a.comments ?? null) === b.comments
  const idx = lines.findIndex((l) => sameKey(l, incoming))
  if (idx !== -1) {
    const next = lines.slice()
    next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + incoming.quantity }
    return next
  }
  return [...lines, { ...incoming, id: newLineId() }]
}

function wholeNonNegativeOrZero(value: number | undefined | null): number {
  if (value === undefined || value === null) return 0
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 0
  if (value < 0) return 0
  return value
}

export function orderDraftReducer(state: OrderDraft, action: OrderDraftAction): OrderDraft {
  switch (action.type) {
    case 'setPhoneInput': {
      // A lookup only describes the number it was made for: typing another
      // number drops the found customer and any address picked for them.
      const found = state.lookup.kind === 'existing' ? state.lookup.customer.phone : state.lookup.phone
      if (state.lookup.kind === 'none' || normalizePhone(action.value) === normalizePhone(found)) {
        return { ...state, phoneInput: action.value }
      }
      return { ...state, phoneInput: action.value, lookup: { kind: 'none', phone: '' }, addressChoice: { kind: 'none' } }
    }

    case 'setLookup': {
      // A saved address belongs to the previous lookup; only a new one survives.
      const keepAddress = state.addressChoice.kind === 'new'
      return { ...state, lookup: action.lookup, addressChoice: keepAddress ? state.addressChoice : { kind: 'none' } }
    }

    case 'setCustomerName':
      return { ...state, customerName: action.value }

    case 'setAddressExisting':
      return { ...state, addressChoice: { kind: 'existing', addressId: action.addressId } }

    case 'setAddressNew':
      return {
        ...state,
        addressChoice: {
          kind: 'new',
          addressLine: action.addressLine,
          neighborhood: action.neighborhood,
          reference: action.reference,
          label: action.label,
          save: state.addressChoice.kind === 'new' ? state.addressChoice.save : false,
        },
      }

    case 'setAddressSave':
      if (state.addressChoice.kind !== 'new') return state
      return { ...state, addressChoice: { ...state.addressChoice, save: action.value } }

    case 'addItem':
      return {
        ...state,
        cartLines: mergeCartLine(state.cartLines, {
          dishId: action.line.dishId,
          name: action.line.name,
          unitPrice: action.line.unitPrice,
          quantity: action.line.quantity,
          comments: action.line.comments,
        }),
      }

    case 'incrementItem': {
      const idx = state.cartLines.findIndex((l) => l.id === action.lineId)
      if (idx === -1) return state
      const next = state.cartLines.slice()
      next[idx] = { ...next[idx]!, quantity: next[idx]!.quantity + 1 }
      return { ...state, cartLines: next }
    }

    case 'decrementItem': {
      const idx = state.cartLines.findIndex((l) => l.id === action.lineId)
      if (idx === -1) return state
      const line = state.cartLines[idx]!
      if (line.quantity <= 1) {
        return { ...state, cartLines: state.cartLines.filter((_, i) => i !== idx) }
      }
      const next = state.cartLines.slice()
      next[idx] = { ...line, quantity: line.quantity - 1 }
      return { ...state, cartLines: next }
    }

    case 'removeItem':
      if (!state.cartLines.some((l) => l.id === action.lineId)) return state
      return { ...state, cartLines: state.cartLines.filter((l) => l.id !== action.lineId) }

    case 'setItemComments': {
      const idx = state.cartLines.findIndex((l) => l.id === action.lineId)
      if (idx === -1) return state
      const next = state.cartLines.slice()
      next[idx] = { ...next[idx]!, comments: action.comments }
      return { ...state, cartLines: next }
    }

    case 'setFee':
      return { ...state, fee: wholeNonNegativeOrZero(action.value) }

    case 'setPaymentMode':
      if (action.value === 'prepaid' && state.cashChangeFor !== null) {
        return { ...state, paymentMode: 'prepaid', cashChangeFor: null }
      }
      return { ...state, paymentMode: action.value }

    case 'setCashChangeFor': {
      if (action.value === null) return { ...state, cashChangeFor: null }
      if (!Number.isFinite(action.value) || !Number.isInteger(action.value) || action.value < 0) {
        return state
      }
      return { ...state, cashChangeFor: action.value }
    }

    case 'setNotes': {
      if (action.value === null) return { ...state, notes: null }
      const trimmed = action.value.trim()
      if (trimmed.length === 0) return { ...state, notes: null }
      return { ...state, notes: action.value }
    }

    case 'reset':
      return initialOrderDraft({ suggestedFee: action.suggestedFee })
  }
}

// -----------------------------------------------------------
// validateDraft
// -----------------------------------------------------------

export interface DraftValidationIssue {
  field: 'phone' | 'customerName' | 'address' | 'items' | 'fee' | 'cashChangeFor'
  message: string
}

/**
 * Spanish error messages, one per broken invariant. The list is
 * empty when the draft is submittable. The view renders every
 * issue inline + on the submit summary so a missed field never
 * silently blocks the order.
 *
 * Rules (each maps to a server-side invariant):
 *   - phone must normalize to 7..15 (matches server CHECK)
 *   - customerName required for a NEW customer (server CHECK enforces)
 *   - addressChoice must be existing{id} or new{addressLine non-empty}
 *   - cartLines must be non-empty (server CHECK enforces 1..99)
 *   - fee must be >= 0 (server CHECK enforces)
 *   - cashChangeFor, when set, must be >= bill total (matches what the
 *     courier can carry back; below this, the courier would have to
 *     hand back negative change)
 */
export function validateDraft(draft: OrderDraft, taxPct = 8): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = []

  // phone
  if (normalizeDraftPhone(draft) === null) {
    issues.push({ field: 'phone', message: 'Ingresa un teléfono válido (7 a 15 dígitos)' })
  }

  // customerName — required unless the lookup resolved an existing
  // customer (in which case the server only updates the registry name
  // when the request carries a different value, so omitting the field
  // is fine). Both `kind: 'none'` (operator never pressed Buscar) and
  // `kind: 'new'` (no row) gate the name as required.
  if (draft.lookup.kind !== 'existing' && draft.customerName.trim().length === 0) {
    issues.push({ field: 'customerName', message: 'El nombre del cliente es obligatorio' })
  }

  // address
  if (draft.addressChoice.kind === 'none') {
    issues.push({ field: 'address', message: 'Selecciona o ingresa una dirección' })
  } else if (
    draft.addressChoice.kind === 'new' &&
    draft.addressChoice.addressLine.trim().length === 0
  ) {
    issues.push({ field: 'address', message: 'La dirección es obligatoria' })
  } else if (draft.addressChoice.kind === 'existing') {
    const { addressId } = draft.addressChoice
    const owned = draft.lookup.kind === 'existing' && draft.lookup.addresses.some((a) => a.id === addressId)
    if (!owned) issues.push({ field: 'address', message: 'Selecciona una dirección del cliente' })
  }

  // >=1 line
  if (draft.cartLines.length === 0) {
    issues.push({ field: 'items', message: 'Agrega al menos un producto al pedido' })
  }

  // fee >= 0 (defensive; the reducer also rejects negatives)
  if (!Number.isFinite(draft.fee) || !Number.isInteger(draft.fee) || draft.fee < 0) {
    issues.push({ field: 'fee', message: 'El domicilio no puede tener un valor negativo' })
  }

  // cashChangeFor >= total when set
  if (draft.cashChangeFor !== null) {
    const totals = draftTotals(draft, taxPct)
    if (draft.cashChangeFor < totals.total) {
      issues.push({
        field: 'cashChangeFor',
        message: 'El cambio que lleva el domiciliario debe ser mayor o igual al total',
      })
    }
  }

  return issues
}

/**
 * Mirror of `normalizePhone` from `./phone` but tolerant of a
 * possibly-empty draft (returns null on empty input rather than
 * throwing — the validator only cares "is this a valid phone?").
 */
function normalizeDraftPhone(draft: OrderDraft): string | null {
  // If the registry has an existing phone, validate it directly.
  const source = draft.phoneInput
  const trimmed = (source ?? '').trim()
  if (trimmed.length === 0) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return null
  if (
    digits.startsWith('57') &&
    digits.length === 12 &&
    digits.charAt(2) === '3'
  ) {
    return digits.slice(2)
  }
  if (digits.length < 7 || digits.length > 15) return null
  return digits
}

// -----------------------------------------------------------
// draftTotals
// -----------------------------------------------------------

export interface DraftTotals {
  subtotal: number
  tax: number
  fee: number
  total: number
}

/**
 * Display estimate. subtotal = Σ(unitPrice * quantity). tax =
 * round(subtotal * taxPct / 100) — no cents. fee is added as-is
 * (no tax, no tip on the fee, matching `pay_order` amount_due).
 *
 * The server is still authoritative on `create_delivery_order`
 * (it resolves prices from the menu, not the form); the dialog
 * shows this number only as "preview / operator expectation".
 */
export function draftTotals(draft: OrderDraft, taxPct: number): DraftTotals {
  if (!Number.isFinite(taxPct) || taxPct < 0) {
    throw new RangeError(`draftTotals: taxPct must be a non-negative finite number; received: ${taxPct}`)
  }
  const subtotal = draft.cartLines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  )
  const tax = Math.round(subtotal * (taxPct / 100))
  const fee = draft.fee
  return { subtotal, tax, fee, total: subtotal + tax + fee }
}

// -----------------------------------------------------------
// toCreateInput
// -----------------------------------------------------------

/**
 * Translate the draft to the exact shape `createDeliveryOrder`
 * expects. Customer + address halves are mininal: existing ->
 * `{id}`, new -> the registry fields the server persists. Items
 * use `{dishId, quantity, comments?}` and drop the name/unitPrice
 * (the server resolves those from the menu).
 *
 * Notes are trimmed so empty / blank trimmed notes become undefined
 * and the JSONB layer forwards NULL to the column.
 */
export function toCreateInput(draft: OrderDraft): CreateDeliveryOrderInput {
  const customer: CreateDeliveryCustomerInput =
    draft.lookup.kind === 'existing'
      ? { id: draft.lookup.customer.id }
      : { phone: normalizeDraftPhone(draft) ?? '', name: draft.customerName.trim() || undefined }

  let address: CreateDeliveryAddressInput
  if (draft.addressChoice.kind === 'existing') {
    address = { id: draft.addressChoice.addressId }
  } else if (draft.addressChoice.kind === 'new') {
    address = {
      addressLine: draft.addressChoice.addressLine.trim(),
      neighborhood: draft.addressChoice.neighborhood,
      reference: draft.addressChoice.reference,
      label: draft.addressChoice.label,
      save: draft.addressChoice.save,
    }
  } else {
    // The view's submit gate ensures this branch is unreachable in
    // practice; mirror the wire shape with an empty address so a
    // direct caller still gets a typed result.
    address = { addressLine: '' }
  }

  const items: CreateDeliveryItemInput[] = draft.cartLines.map((line) => {
    const out: CreateDeliveryItemInput = {
      dishId: line.dishId,
      quantity: line.quantity,
    }
    if (line.comments !== null && line.comments.length > 0) {
      out.comments = line.comments
    }
    return out
  })

  const notes =
    draft.notes !== null && draft.notes.trim().length > 0 ? draft.notes.trim() : null

  return {
    customer,
    address,
    items,
    deliveryFee: draft.fee,
    paymentMode: draft.paymentMode,
    cashChangeFor: draft.cashChangeFor,
    notes,
  }
}