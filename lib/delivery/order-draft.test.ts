/**
 * Order-draft reducer + helpers for the delivery operator's
 * "Nuevo domicilio" flow.
 *
 * Pure: no Supabase, no DOM, no zustand. The view layer feeds the
 * `fetchCustomerByPhone` result into `setLookup` and drives the form
 * with `orderDraftReducer`. `validateDraft` is the single source of
 * truth for "submit enabled" + per-field Spanish error messages.
 * `toCreateInput` translates the draft to the wire shape
 * `createDeliveryOrder` expects.
 *
 * Money is whole Colombian pesos (COP); the reducer rejects
 * non-integer / negative fee and `cashChangeFor` so a UI bug cannot
 * reach `validateCreateDeliveryInput` on the service with garbage.
 */

import { describe, expect, it } from 'vitest'
import {
  initialOrderDraft,
  orderDraftReducer,
  validateDraft,
  draftTotals,
  toCreateInput,
} from './order-draft'
import type {
  Customer,
  CustomerAddress,
} from './types'

// -----------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: overrides.id ?? 'cust-1',
    phone: overrides.phone ?? '3101234567',
    name: overrides.name ?? 'Ana Pérez',
    notes: overrides.notes ?? null,
    createdAt: overrides.createdAt ?? '2026-10-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-10-01T00:00:00.000Z',
  }
}

function makeAddress(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: overrides.id ?? 'addr-1',
    customerId: overrides.customerId ?? 'cust-1',
    label: overrides.label ?? null,
    addressLine: overrides.addressLine ?? 'Calle 5 # 10-20',
    neighborhood: overrides.neighborhood ?? 'Centro',
    reference: overrides.reference ?? null,
    isDefault: overrides.isDefault ?? true,
    createdAt: overrides.createdAt ?? '2026-10-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-10-01T00:00:00.000Z',
  }
}

// -----------------------------------------------------------
// initialOrderDraft
// -----------------------------------------------------------

describe('initialOrderDraft', () => {
  it('starts empty: no phone, no lookup, no name, no address, no items', () => {
    const d = initialOrderDraft({ suggestedFee: 3000 })
    expect(d.phoneInput).toBe('')
    expect(d.lookup).toEqual({ kind: 'none', phone: '' })
    expect(d.customerName).toBe('')
    expect(d.addressChoice).toEqual({ kind: 'none' })
    expect(d.cartLines).toEqual([])
    expect(d.fee).toBe(3000)
    expect(d.paymentMode).toBe('cash_on_delivery')
    expect(d.cashChangeFor).toBeNull()
    expect(d.notes).toBeNull()
  })

  it('preloads the fee from the suggested value (whole pesos, >= 0)', () => {
    expect(initialOrderDraft({ suggestedFee: 0 }).fee).toBe(0)
    expect(initialOrderDraft({ suggestedFee: 5000 }).fee).toBe(5000)
  })

  it('throws when the suggested fee is negative or non-integer (defensive)', () => {
    expect(() => initialOrderDraft({ suggestedFee: -1 })).toThrow(/fee/i)
    expect(() => initialOrderDraft({ suggestedFee: 1.5 })).toThrow(/fee/i)
  })
})

// -----------------------------------------------------------
// phone + lookup
// -----------------------------------------------------------

describe('setPhoneInput / setLookup', () => {
  it('setPhoneInput stores the raw operator input verbatim', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, { type: 'setPhoneInput', value: '+57 310 123 4567' })
    expect(d1.phoneInput).toBe('+57 310 123 4567')
  })

  it('setLookup "existing" stores the registry snapshot and the default address id', () => {
    const customer = makeCustomer({ id: 'cust-7', phone: '3101234567' })
    const a1 = makeAddress({ id: 'addr-1', isDefault: true })
    const a2 = makeAddress({ id: 'addr-2', isDefault: false })
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, {
      type: 'setLookup',
      lookup: { kind: 'existing', customer, addresses: [a1, a2], defaultAddressId: 'addr-1' },
    })
    expect(d1.lookup).toEqual({
      kind: 'existing',
      customer,
      addresses: [a1, a2],
      defaultAddressId: 'addr-1',
    })
  })

  it('setLookup "new" carries the normalized phone but no customer', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, {
      type: 'setLookup',
      lookup: { kind: 'new', phone: '3101234567' },
    })
    expect(d1.lookup).toEqual({ kind: 'new', phone: '3101234567' })
  })

  it('setLookup "none" resets the registry result but keeps the rest of the draft', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '310' })
    d = orderDraftReducer(d, {
      type: 'setLookup',
      lookup: { kind: 'new', phone: '310' },
    })
    d = orderDraftReducer(d, { type: 'setNotes', value: 'Sin cebolla' })
    d = orderDraftReducer(d, { type: 'setLookup', lookup: { kind: 'none', phone: '' } })
    expect(d.lookup).toEqual({ kind: 'none', phone: '' })
    expect(d.notes).toBe('Sin cebolla')
  })
})

// -----------------------------------------------------------
// customer name
// -----------------------------------------------------------

describe('setCustomerName', () => {
  it('stores the name verbatim (the form trims before submitting)', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, { type: 'setCustomerName', value: '  Ana Pérez ' })
    expect(d1.customerName).toBe('  Ana Pérez ')
  })
})

// -----------------------------------------------------------
// address
// -----------------------------------------------------------

describe('setAddressExisting / setAddressNew / setAddressSave', () => {
  it('setAddressExisting switches the choice to an existing address id', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, { type: 'setAddressExisting', addressId: 'addr-7' })
    expect(d1.addressChoice).toEqual({ kind: 'existing', addressId: 'addr-7' })
  })

  it('setAddressNew keeps the typed fields and remembers save=false by default', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, {
      type: 'setAddressNew',
      addressLine: 'Calle 5 # 10-20',
      neighborhood: 'Centro',
      reference: 'junto al parque',
      label: 'Casa',
    })
    expect(d1.addressChoice).toEqual({
      kind: 'new',
      addressLine: 'Calle 5 # 10-20',
      neighborhood: 'Centro',
      reference: 'junto al parque',
      label: 'Casa',
      save: false,
    })
  })

  it('setAddressSave toggles the save flag without dropping the fields', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'setAddressNew',
      addressLine: 'Calle 5',
      neighborhood: null,
      reference: null,
      label: null,
    })
    expect(d.addressChoice).toMatchObject({ kind: 'new', save: false })
    d = orderDraftReducer(d, { type: 'setAddressSave', value: true })
    expect(d.addressChoice).toMatchObject({ kind: 'new', save: true })
    d = orderDraftReducer(d, { type: 'setAddressSave', value: false })
    expect(d.addressChoice).toMatchObject({ kind: 'new', save: false })
  })
})

// -----------------------------------------------------------
// cart
// -----------------------------------------------------------

describe('cart actions', () => {
  it('addItem appends a new line (or increments an existing one with the same dish + comments)', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: 'sin cebolla',
      },
    })
    expect(d1.cartLines).toHaveLength(1)
    expect(d1.cartLines[0]).toMatchObject({
      dishId: 'dish-1',
      quantity: 1,
      comments: 'sin cebolla',
    })
    // adding the same dish + comments bumps quantity
    const d2 = orderDraftReducer(d1, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: 'sin cebolla',
      },
    })
    expect(d2.cartLines).toHaveLength(1)
    expect(d2.cartLines[0]?.quantity).toBe(2)
  })

  it('addItem keeps separate lines when comments differ', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: 'sin cebolla',
      },
    })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: 'extra queso',
      },
    })
    expect(d.cartLines).toHaveLength(2)
  })

  it('incrementItem / decrementItem move the quantity by +1 / -1', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: null,
      },
    })
    const id = d.cartLines[0]!.id
    d = orderDraftReducer(d, { type: 'incrementItem', lineId: id })
    d = orderDraftReducer(d, { type: 'incrementItem', lineId: id })
    expect(d.cartLines[0]?.quantity).toBe(3)
    d = orderDraftReducer(d, { type: 'decrementItem', lineId: id })
    expect(d.cartLines[0]?.quantity).toBe(2)
  })

  it('decrementItem below 1 removes the line (cart is silent in CartSidebar too)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: null,
      },
    })
    const id = d.cartLines[0]!.id
    d = orderDraftReducer(d, { type: 'decrementItem', lineId: id })
    expect(d.cartLines).toHaveLength(0)
  })

  it('removeItem drops the line by id', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: null,
      },
    })
    const id = d.cartLines[0]!.id
    d = orderDraftReducer(d, { type: 'removeItem', lineId: id })
    expect(d.cartLines).toHaveLength(0)
  })

  it('setItemComments updates an existing line and rejects an unknown id (no-op)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: {
        dishId: 'dish-1',
        name: 'Hamburguesa',
        unitPrice: 15000,
        quantity: 1,
        comments: null,
      },
    })
    const id = d.cartLines[0]!.id
    d = orderDraftReducer(d, { type: 'setItemComments', lineId: id, comments: 'sin picante' })
    expect(d.cartLines[0]?.comments).toBe('sin picante')
    d = orderDraftReducer(d, { type: 'setItemComments', lineId: 'no-such-id', comments: 'x' })
    expect(d.cartLines[0]?.comments).toBe('sin picante')
  })
})

// -----------------------------------------------------------
// fee / payment mode / cash change / notes
// -----------------------------------------------------------

describe('fee / payment / cashChange / notes', () => {
  it('setFee stores a whole, non-negative peso amount (otherwise input is dropped)', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, { type: 'setFee', value: 3500 })
    expect(d1.fee).toBe(3500)
    const d2 = orderDraftReducer(d0, { type: 'setFee', value: -100 })
    expect(d2.fee).toBe(0)
    const d3 = orderDraftReducer(d0, { type: 'setFee', value: 1.5 })
    expect(d3.fee).toBe(0)
  })

  it('setPaymentMode stores the mode and clears cashChangeFor on prepaid', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 50000 })
    expect(d.cashChangeFor).toBe(50000)
    d = orderDraftReducer(d, { type: 'setPaymentMode', value: 'prepaid' })
    expect(d.paymentMode).toBe('prepaid')
    expect(d.cashChangeFor).toBeNull()
  })

  it('setCashChangeFor stores the amount for COD and ignores values below total (the form gates submit)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 10000, quantity: 1, comments: null } })
    d = orderDraftReducer(d, { type: 'setFee', value: 2000 })
    // total = subtotal (10000) + tax + fee (2000) — but the reducer stores the raw number,
    // the form layer computes the comparison; the reducer never rejects amounts.
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 50000 })
    expect(d.cashChangeFor).toBe(50000)
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: null })
    expect(d.cashChangeFor).toBeNull()
  })

  it('setNotes stores the free-form note (the service trims to <=300)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setNotes', value: 'Tocar el timbre 2 veces' })
    expect(d.notes).toBe('Tocar el timbre 2 veces')
    d = orderDraftReducer(d, { type: 'setNotes', value: null })
    expect(d.notes).toBeNull()
  })
})

// -----------------------------------------------------------
// reset
// -----------------------------------------------------------

describe('reset', () => {
  it('returns to the empty draft (with the caller-provided suggested fee)', () => {
    let d = initialOrderDraft({ suggestedFee: 3000 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '3101234567' })
    d = orderDraftReducer(d, { type: 'setNotes', value: 'nota' })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 1000, quantity: 1, comments: null } })
    d = orderDraftReducer(d, { type: 'reset', suggestedFee: 5000 })
    expect(d).toEqual(initialOrderDraft({ suggestedFee: 5000 }))
  })
})

// -----------------------------------------------------------
// validateDraft
// -----------------------------------------------------------

describe('validateDraft', () => {
  it('empty draft reports every field error in Spanish', () => {
    const errs = validateDraft(initialOrderDraft({ suggestedFee: 0 }))
    // phone, name (no customer lookup -> new customer is implied -> name required),
    // address, items, fee is OK.
    expect(errs.find((e) => e.field === 'phone')?.message).toMatch(/teléfono/i)
    expect(errs.find((e) => e.field === 'customerName')?.message).toMatch(/nombre/i)
    expect(errs.find((e) => e.field === 'address')?.message).toMatch(/direcci[oó]n/i)
    expect(errs.find((e) => e.field === 'items')?.message).toMatch(/producto/i)
  })

  it('flags an invalid phone', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = orderDraftReducer(d0, { type: 'setPhoneInput', value: '123' })
    expect(validateDraft(d1).some((e) => e.field === 'phone')).toBe(true)
  })

  it('does NOT flag customerName when the customer already exists (server only updates the registry on a different value)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '3101234567' })
    d = orderDraftReducer(d, {
      type: 'setLookup',
      lookup: {
        kind: 'existing',
        customer: makeCustomer({ id: 'cust-1', name: 'Ana' }),
        addresses: [makeAddress({ id: 'addr-1' })],
        defaultAddressId: 'addr-1',
      },
    })
    d = orderDraftReducer(d, { type: 'setAddressExisting', addressId: 'addr-1' })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 1000, quantity: 1, comments: null } })
    const errs = validateDraft(d)
    expect(errs.find((e) => e.field === 'customerName')).toBeUndefined()
    expect(errs.find((e) => e.field === 'phone')).toBeUndefined()
    expect(errs.find((e) => e.field === 'address')).toBeUndefined()
    expect(errs.find((e) => e.field === 'items')).toBeUndefined()
    expect(errs).toEqual([])
  })

  it('flags a negative fee (defensive — the reducer would have dropped it, the validator is the safety net)', () => {
    const d0 = initialOrderDraft({ suggestedFee: 0 })
    const d1 = { ...d0, fee: -100 }
    expect(validateDraft(d1).find((e) => e.field === 'fee')).toBeDefined()
  })

  it('flags cashChangeFor below the bill total (only checked when set)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 10000, quantity: 1, comments: null } })
    d = orderDraftReducer(d, { type: 'setFee', value: 2000 })
    // total = 10000 + 800 (tax 8%) + 2000 = 12800
    d = orderDraftReducer(d, { type: 'setPaymentMode', value: 'cash_on_delivery' })
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 5000 }) // below 12800
    const err = validateDraft(d).find((e) => e.field === 'cashChangeFor')
    expect(err).toBeDefined()
    expect(err?.message).toMatch(/cambio/i)
  })

  it('does not flag cashChangeFor when it equals or exceeds the total', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 10000, quantity: 1, comments: null } })
    d = orderDraftReducer(d, { type: 'setFee', value: 2000 })
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 12800 })
    expect(validateDraft(d).find((e) => e.field === 'cashChangeFor')).toBeUndefined()
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 20000 })
    expect(validateDraft(d).find((e) => e.field === 'cashChangeFor')).toBeUndefined()
  })

  it('does not flag cashChangeFor for prepaid (server rejects anyway)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPaymentMode', value: 'prepaid' })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'X', unitPrice: 10000, quantity: 1, comments: null } })
    // no cash change set; nothing to flag
    expect(validateDraft(d).find((e) => e.field === 'cashChangeFor')).toBeUndefined()
  })
})

// -----------------------------------------------------------
// draftTotals
// -----------------------------------------------------------

describe('draftTotals', () => {
  it('computes subtotal (sum of unitPrice * quantity) and tax from the passed taxPct', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'A', unitPrice: 10000, quantity: 2, comments: null } })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd2', name: 'B', unitPrice: 5000, quantity: 1, comments: null } })
    const totals = draftTotals(d, 8)
    expect(totals.subtotal).toBe(25000)
    expect(totals.tax).toBe(2000) // 25000 * 8% = 2000
    expect(totals.fee).toBe(0)
    expect(totals.total).toBe(27000)
  })

  it('fee has no tax and no tip (matches the server\'s pay_order amount_due shape)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setFee', value: 3000 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'A', unitPrice: 10000, quantity: 1, comments: null } })
    const totals = draftTotals(d, 8)
    expect(totals.subtotal).toBe(10000)
    expect(totals.tax).toBe(800)
    expect(totals.fee).toBe(3000)
    expect(totals.total).toBe(13800)
  })

  it('rounds the tax with Math.round (avoids cents surfacing in the dialog)', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'addItem', line: { dishId: 'd1', name: 'A', unitPrice: 12345, quantity: 1, comments: null } })
    const totals = draftTotals(d, 8)
    expect(totals.tax).toBe(988) // 12345 * 0.08 = 987.6 -> 988
  })

  it('rejects a non-finite or negative taxPct (defensive)', () => {
    const draft = initialOrderDraft({ suggestedFee: 0 })
    expect(() => draftTotals(draft, -1)).toThrow(/tax/i)
    expect(() => draftTotals(draft, Number.NaN)).toThrow(/tax/i)
  })
})

// -----------------------------------------------------------
// toCreateInput
// -----------------------------------------------------------

describe('toCreateInput', () => {
  it('for an existing customer + existing address forwards {id} on both and item comments verbatim', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '3101234567' })
    d = orderDraftReducer(d, {
      type: 'setLookup',
      lookup: {
        kind: 'existing',
        customer: makeCustomer({ id: 'cust-1' }),
        addresses: [makeAddress({ id: 'addr-1' })],
        defaultAddressId: 'addr-1',
      },
    })
    d = orderDraftReducer(d, { type: 'setAddressExisting', addressId: 'addr-1' })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: { dishId: 'd1', name: 'Hamburguesa', unitPrice: 15000, quantity: 2, comments: 'sin cebolla' },
    })
    d = orderDraftReducer(d, { type: 'setFee', value: 2500 })
    d = orderDraftReducer(d, { type: 'setPaymentMode', value: 'prepaid' })
    d = orderDraftReducer(d, { type: 'setNotes', value: '  Tocar el timbre  ' })

    const input = toCreateInput(d)
    expect(input.customer).toEqual({ id: 'cust-1' })
    expect(input.address).toEqual({ id: 'addr-1' })
    expect(input.items).toEqual([
      { dishId: 'd1', quantity: 2, comments: 'sin cebolla' },
    ])
    expect(input.deliveryFee).toBe(2500)
    expect(input.paymentMode).toBe('prepaid')
    expect(input.cashChangeFor).toBeNull()
    // Trimmed notes; the server CHECK enforces the same btrim rule.
    expect(input.notes).toBe('Tocar el timbre')
  })

  it('for a new customer + new address forwards {phone, name} + new address fields with save flag', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '+57 310 123 4567' })
    d = orderDraftReducer(d, {
      type: 'setLookup',
      lookup: { kind: 'new', phone: '3101234567' },
    })
    d = orderDraftReducer(d, { type: 'setCustomerName', value: 'Ana Pérez' })
    d = orderDraftReducer(d, {
      type: 'setAddressNew',
      addressLine: 'Calle 5 # 10-20',
      neighborhood: 'Centro',
      reference: null,
      label: null,
    })
    d = orderDraftReducer(d, { type: 'setAddressSave', value: true })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: { dishId: 'd1', name: 'Hamburguesa', unitPrice: 15000, quantity: 1, comments: null },
    })
    d = orderDraftReducer(d, { type: 'setFee', value: 0 })
    d = orderDraftReducer(d, { type: 'setPaymentMode', value: 'cash_on_delivery' })
    d = orderDraftReducer(d, { type: 'setCashChangeFor', value: 20000 })

    const input = toCreateInput(d)
    expect(input.customer).toEqual({ phone: '3101234567', name: 'Ana Pérez' })
    expect(input.address).toEqual({
      addressLine: 'Calle 5 # 10-20',
      neighborhood: 'Centro',
      reference: null,
      label: null,
      save: true,
    })
    expect(input.paymentMode).toBe('cash_on_delivery')
    expect(input.cashChangeFor).toBe(20000)
  })

  it('uses the normalized phone from the lookup, not the raw operator input', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setPhoneInput', value: '+57 (310) 123-4567' })
    d = orderDraftReducer(d, { type: 'setLookup', lookup: { kind: 'new', phone: '3101234567' } })
    d = orderDraftReducer(d, { type: 'setCustomerName', value: 'Ana' })
    d = orderDraftReducer(d, {
      type: 'setAddressNew',
      addressLine: 'Calle 5',
      neighborhood: null,
      reference: null,
      label: null,
    })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: { dishId: 'd1', name: 'X', unitPrice: 1000, quantity: 1, comments: null },
    })
    expect(toCreateInput(d).customer).toEqual({ phone: '3101234567', name: 'Ana' })
  })

  it('maps item comments=null to "omitted" so the service forwards comments only when set', () => {
    let d = initialOrderDraft({ suggestedFee: 0 })
    d = orderDraftReducer(d, { type: 'setLookup', lookup: { kind: 'new', phone: '3101234567' } })
    d = orderDraftReducer(d, { type: 'setCustomerName', value: 'Ana' })
    d = orderDraftReducer(d, {
      type: 'setAddressNew',
      addressLine: 'Calle 5',
      neighborhood: null,
      reference: null,
      label: null,
    })
    d = orderDraftReducer(d, {
      type: 'addItem',
      line: { dishId: 'd1', name: 'X', unitPrice: 1000, quantity: 1, comments: null },
    })
    const input = toCreateInput(d)
    expect(input.items[0]).toEqual({ dishId: 'd1', quantity: 1 })
    expect(Object.prototype.hasOwnProperty.call(input.items[0], 'comments')).toBe(false)
  })
})