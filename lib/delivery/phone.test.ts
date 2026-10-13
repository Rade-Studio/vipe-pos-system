import { describe, expect, it } from 'vitest'
import { formatPhone, normalizePhone } from './phone'

// -----------------------------------------------------------
// normalizePhone
// -----------------------------------------------------------
//
// The server CHECK (customers.phone / couriers.phone /
// order_deliveries.customer_phone) is `^[0-9]{7,15}$`. The
// Colombian country code is `57`, mobile numbers are 10 digits and
// start with `3`. We strip `+57` / `57` ONLY when the remainder is
// exactly a 10-digit Colombian mobile (3 + 9 digits) so a 7..15
// digit international number is not silently truncated.

describe('normalizePhone', () => {
  it('strips a +57 prefix when the remainder is a 10-digit Colombian mobile', () => {
    expect(normalizePhone('+573101234567')).toBe('3101234567')
    expect(normalizePhone('+57 310 123 4567')).toBe('3101234567')
    expect(normalizePhone('+57-310-123-4567')).toBe('3101234567')
  })

  it('strips a 57 prefix (no plus) when the remainder is a 10-digit Colombian mobile', () => {
    expect(normalizePhone('573101234567')).toBe('3101234567')
  })

  it('returns the digits when no prefix is present', () => {
    expect(normalizePhone('3101234567')).toBe('3101234567')
    expect(normalizePhone('310-123-4567')).toBe('3101234567')
    expect(normalizePhone('(310) 123 4567')).toBe('3101234567')
  })

  it('keeps the 57 prefix when the remainder is NOT a Colombian mobile', () => {
    // 57 + 01234567 (8 digits, not a mobile). 12 digits is still valid
    // (within 7..15), but the prefix strip rule does not apply.
    expect(normalizePhone('5701234567')).toBe('5701234567')
    // 57 + 1234567 (7 digits, not 10): strip would push us below the
    // minimum, so we keep the 57 prefix.
    expect(normalizePhone('571234567')).toBe('571234567')
    // Starts with 57 but the next digit is not 3 (so not a Colombian
    // mobile): keep the prefix verbatim.
    expect(normalizePhone('571010123456')).toBe('571010123456')
  })

  it('returns null when the digit count is below 7', () => {
    expect(normalizePhone('123456')).toBeNull()
    expect(normalizePhone('12345')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })

  it('returns null when the digit count is above 15', () => {
    expect(normalizePhone('1234567890123456')).toBeNull()
  })

  it('returns null when the input carries no digits', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('()-')).toBeNull()
  })

  it('accepts the boundary lengths 7 and 15', () => {
    expect(normalizePhone('1234567')).toBe('1234567')
    expect(normalizePhone('123456789012345')).toBe('123456789012345')
  })
})

// -----------------------------------------------------------
// formatPhone
// -----------------------------------------------------------

describe('formatPhone', () => {
  it('inserts spaces as a Colombian 3-3-4 grouping for a 10-digit mobile', () => {
    expect(formatPhone('3101234567')).toBe('310 123 4567')
  })

  it('inserts the +57 prefix for a 10-digit Colombian mobile when missing', () => {
    expect(formatPhone('3101234567', { withCountryCode: true })).toBe(
      '+57 310 123 4567',
    )
  })

  it('does not double-prefix when the input already carries 57', () => {
    expect(formatPhone('573101234567')).toBe('+57 310 123 4567')
    expect(formatPhone('573101234567', { withCountryCode: true })).toBe(
      '+57 310 123 4567',
    )
  })

  it('falls back to the raw value when the shape does not fit 3-3-4', () => {
    expect(formatPhone('123456789012345')).toBe('123456789012345')
  })
})