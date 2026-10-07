import { describe, expect, it } from 'vitest'
import { formatAddress, pickDefaultAddress } from './address'
import type { CustomerAddress } from './types'

// -----------------------------------------------------------
// formatAddress
// -----------------------------------------------------------

describe('formatAddress', () => {
  it('joins address_line + neighborhood + reference on a single Spanish line', () => {
    expect(
      formatAddress({
        addressLine: 'Calle 5 # 10-20',
        neighborhood: 'Centro',
        reference: 'junto al parque',
      }),
    ).toBe('Calle 5 # 10-20, Centro (junto al parque)')
  })

  it('omits the neighborhood when it is null / empty / whitespace', () => {
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: null, reference: null })).toBe('Calle 5')
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: '', reference: null })).toBe('Calle 5')
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: '   ', reference: null })).toBe('Calle 5')
  })

  it('omits the reference when it is null / empty / whitespace', () => {
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: 'Centro', reference: null })).toBe(
      'Calle 5, Centro',
    )
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: 'Centro', reference: '' })).toBe(
      'Calle 5, Centro',
    )
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: 'Centro', reference: '  ' })).toBe(
      'Calle 5, Centro',
    )
  })

  it('renders reference in parens after the address_line + neighborhood', () => {
    expect(
      formatAddress({
        addressLine: 'Calle 5',
        neighborhood: 'Centro',
        reference: 'portón verde',
      }),
    ).toBe('Calle 5, Centro (portón verde)')
  })

  it('renders the address_line alone when both neighborhood and reference are missing', () => {
    expect(formatAddress({ addressLine: 'Calle 5', neighborhood: null, reference: null })).toBe('Calle 5')
  })

  it('throws when address_line is empty (defensive - the server CHECK rejects it too)', () => {
    expect(() =>
      formatAddress({ addressLine: '', neighborhood: null, reference: null }),
    ).toThrow(/address_line/i)
    expect(() =>
      formatAddress({ addressLine: '   ', neighborhood: null, reference: null }),
    ).toThrow(/address_line/i)
  })
})

// -----------------------------------------------------------
// pickDefaultAddress
// -----------------------------------------------------------

function makeAddress(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    customerId: overrides.customerId ?? 'c-1',
    label: overrides.label ?? null,
    addressLine: overrides.addressLine ?? 'Calle 1',
    neighborhood: overrides.neighborhood ?? null,
    reference: overrides.reference ?? null,
    isDefault: overrides.isDefault ?? false,
    createdAt: overrides.createdAt ?? '2026-10-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-10-01T00:00:00.000Z',
  }
}

describe('pickDefaultAddress', () => {
  it('returns the row flagged is_default=true when present', () => {
    const a = makeAddress({ id: 'a-1', isDefault: false })
    const b = makeAddress({ id: 'a-2', isDefault: true })
    const c = makeAddress({ id: 'a-3', isDefault: false })
    expect(pickDefaultAddress([a, b, c])?.id).toBe('a-2')
  })

  it('returns the first row when none is flagged default', () => {
    const a = makeAddress({ id: 'a-1' })
    const b = makeAddress({ id: 'a-2' })
    expect(pickDefaultAddress([a, b])?.id).toBe('a-1')
  })

  it('returns null for an empty list', () => {
    expect(pickDefaultAddress([])).toBeNull()
  })

  it('returns the single row when the customer has exactly one address, even when not flagged', () => {
    const only = makeAddress({ id: 'a-1', isDefault: false })
    expect(pickDefaultAddress([only])?.id).toBe('a-1')
  })
})