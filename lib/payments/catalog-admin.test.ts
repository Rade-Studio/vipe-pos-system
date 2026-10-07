/**
 * Pure-logic tests for the admin payment-methods helpers.
 *
 * No Supabase, no React: the catalog-admin module exports the small
 * functions the admin screen runs over the result of
 * `listPaymentMethods()`. Each one is tested independently of the
 * service, so the contract (slug shape, name validation, reorder
 * delta, deactivate gates) is pinned here before the UI is wired up.
 */

import { describe, expect, it } from 'vitest'
import {
  canDeactivate,
  moveMethod,
  slugifyMethodCode,
  validateMethodName,
} from './catalog-admin'
import type { PaymentMethodOption } from './types'

function m(over: Partial<PaymentMethodOption> = {}): PaymentMethodOption {
  return {
    id: over.id ?? 'm',
    code: over.code ?? 'm',
    name: over.name ?? 'Método',
    kind: over.kind ?? 'cash',
    isActive: over.isActive ?? true,
    sortOrder: over.sortOrder ?? 0,
  }
}

// -----------------------------------------------------------
// slugifyMethodCode
// -----------------------------------------------------------

describe('slugifyMethodCode', () => {
  it('lowercases a simple name', () => {
    expect(slugifyMethodCode('Efectivo', [])).toBe('efectivo')
  })

  it('strips accents and replaces non [a-z0-9] with _', () => {
    expect(slugifyMethodCode('Tarjeta Débito', [])).toBe('tarjeta_debito')
  })

  it('collapses and trims runs of _', () => {
    expect(slugifyMethodCode('100% Bonos!!', [])).toBe('100_bonos')
  })

  it('pads all-non-alphanum names to length 2 with the m_ pattern', () => {
    expect(slugifyMethodCode('   ', [])).toBe('m_')
    expect(slugifyMethodCode('$$$', [])).toBe('m_')
  })

  it('pads single-char results to length 2', () => {
    expect(slugifyMethodCode('A', []).length).toBe(2)
    expect(slugifyMethodCode('A', [])).toBe('a_')
  })

  it('clamps to 32 chars when the base is longer', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz12345678' // 34 chars
    const out = slugifyMethodCode(long, [])
    expect(out.length).toBe(32)
    expect(out).toBe('abcdefghijklmnopqrstuvwxyz123456')
  })

  it('suffixes _2 on collision within 32 chars', () => {
    expect(slugifyMethodCode('Efectivo', ['efectivo'])).toBe('efectivo_2')
  })

  it('suffixes _3 after _2 is taken', () => {
    expect(
      slugifyMethodCode('Efectivo', ['efectivo', 'efectivo_2']),
    ).toBe('efectivo_3')
  })

  it('trims the base to keep the _N suffix within 32 chars', () => {
    // 34 chars base -> clamped 32; with the _2 suffix the base is
    // shortened to 30 chars so the result fits in 32.
    const long = 'abcdefghijklmnopqrstuvwxyz12345678'
    const code = slugifyMethodCode(long, ['abcdefghijklmnopqrstuvwxyz123456'])
    expect(code).toBe('abcdefghijklmnopqrstuvwxyz1234_2')
    expect(code.length).toBe(32)
  })

  it('returns the base unchanged when the existing list is empty', () => {
    expect(slugifyMethodCode('Nequi', [])).toBe('nequi')
  })
})

// -----------------------------------------------------------
// validateMethodName
// -----------------------------------------------------------

describe('validateMethodName', () => {
  it('returns null for a unique valid name', () => {
    expect(validateMethodName('Daviplata', [])).toBeNull()
  })

  it('returns "empty" for empty or whitespace-only names', () => {
    expect(validateMethodName('', [])).toBe('empty')
    expect(validateMethodName('   ', [])).toBe('empty')
  })

  it('returns "too-long" when the trimmed name is over 60 chars', () => {
    expect(validateMethodName('a'.repeat(61), [])).toBe('too-long')
    // exactly 60 is fine
    expect(validateMethodName('a'.repeat(60), [])).toBeNull()
  })

  it('returns "duplicate" case-insensitively', () => {
    expect(
      validateMethodName('EFECTIVO', [{ name: 'Efectivo' }]),
    ).toBe('duplicate')
    expect(
      validateMethodName('efectivo', [{ name: 'Efectivo' }]),
    ).toBe('duplicate')
  })

  it('returns "duplicate" accent-insensitively', () => {
    expect(
      validateMethodName('Tarjeta Debito', [{ name: 'Tarjeta Débito' }]),
    ).toBe('duplicate')
  })

  it('ignores other entries that do not match', () => {
    expect(
      validateMethodName('Nequi', [
        { name: 'Efectivo' },
        { name: 'Tarjeta Débito' },
      ]),
    ).toBeNull()
  })
})

// -----------------------------------------------------------
// moveMethod
// -----------------------------------------------------------

describe('moveMethod', () => {
  const methods: PaymentMethodOption[] = [
    m({ id: 'a', sortOrder: 0 }),
    m({ id: 'b', sortOrder: 1 }),
    m({ id: 'c', sortOrder: 2 }),
  ]

  it('swaps a row down by one and recomputes contiguous sort_order', () => {
    const { methods: next, changes } = moveMethod(methods, 'a', 'down')
    expect(next.map((x) => x.id)).toEqual(['b', 'a', 'c'])
    expect(next.map((x) => x.sortOrder)).toEqual([0, 1, 2])
    expect(changes).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ])
  })

  it('swaps a row up by one and recomputes contiguous sort_order', () => {
    const { methods: next, changes } = moveMethod(methods, 'c', 'up')
    expect(next.map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(next.map((x) => x.sortOrder)).toEqual([0, 1, 2])
    expect(changes).toEqual([
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
  })

  it('returns no changes when moving past the ends', () => {
    expect(moveMethod(methods, 'a', 'up').changes).toEqual([])
    expect(moveMethod(methods, 'c', 'down').changes).toEqual([])
  })

  it('returns no changes for an unknown id', () => {
    expect(moveMethod(methods, 'z', 'down').changes).toEqual([])
  })

  it('only emits changes for rows whose sort_order changed', () => {
    const { changes } = moveMethod(methods, 'b', 'up')
    // After the move the array is [b, a, c]; b: 1 -> 0, a: 0 -> 1; c: 2
    // stays put, so the change list is the two moved rows in the new
    // order they appear in the catalog.
    expect(changes).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ])
  })

  it('normalizes a non-contiguous input back to 0..n-1', () => {
    const sparse: PaymentMethodOption[] = [
      m({ id: 'a', sortOrder: 0 }),
      m({ id: 'b', sortOrder: 1 }),
      m({ id: 'c', sortOrder: 2 }),
    ]
    const { changes } = moveMethod(sparse, 'a', 'down')
    expect(changes).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ])
  })
})

// -----------------------------------------------------------
// canDeactivate
// -----------------------------------------------------------

describe('canDeactivate', () => {
  it('refuses when this is the only active method in the catalog', () => {
    const methods = [m({ id: 'a', isActive: true })]
    expect(canDeactivate(methods, 'a')).toEqual({
      ok: false,
      reason: 'last-active',
    })
  })

  it('refuses when this is the only active cash method', () => {
    const methods = [
      m({ id: 'a', kind: 'cash', isActive: true }),
      m({ id: 'b', kind: 'electronic', isActive: true }),
    ]
    expect(canDeactivate(methods, 'a')).toEqual({
      ok: false,
      reason: 'last-cash',
    })
  })

  it('allows deactivation when there is another active cash method', () => {
    const methods = [
      m({ id: 'a', kind: 'cash', isActive: true }),
      m({ id: 'b', kind: 'cash', isActive: true }),
    ]
    expect(canDeactivate(methods, 'a')).toBe(true)
  })

  it('refuses on "last-active" when the only method is electronic', () => {
    const methods = [m({ id: 'a', kind: 'electronic', isActive: true })]
    expect(canDeactivate(methods, 'a')).toEqual({
      ok: false,
      reason: 'last-active',
    })
  })

  it('allows deactivating a row that is already inactive', () => {
    const methods = [
      m({ id: 'a', kind: 'cash', isActive: true }),
      m({ id: 'b', kind: 'cash', isActive: false }),
    ]
    expect(canDeactivate(methods, 'b')).toBe(true)
  })

  it('returns true for an unknown id (UI is responsible for the click target)', () => {
    const methods = [m({ id: 'a' })]
    expect(canDeactivate(methods, 'z')).toBe(true)
  })

  it('prefers "last-active" over "last-cash" when both apply', () => {
    // One method, cash, active: deactivating it removes the only active
    // row and the only cash row. The strongest reason wins.
    const methods = [m({ id: 'a', kind: 'cash', isActive: true })]
    expect(canDeactivate(methods, 'a')).toEqual({
      ok: false,
      reason: 'last-active',
    })
  })
})
