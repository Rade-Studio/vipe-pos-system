import { describe, expect, it } from 'vitest'
import { changeForHint, deliveryTotal, parseFeeInput, suggestedFeeFromConfig } from './fee'

// -----------------------------------------------------------
// parseFeeInput
// -----------------------------------------------------------

describe('parseFeeInput', () => {
  it('parses a non-negative integer string', () => {
    expect(parseFeeInput('0')).toBe(0)
    expect(parseFeeInput('3000')).toBe(3000)
    expect(parseFeeInput('  5000  ')).toBe(5000)
  })

  it('rejects empty / whitespace / null input', () => {
    expect(() => parseFeeInput('')).toThrow(/non-empty/i)
    expect(() => parseFeeInput('   ')).toThrow(/non-empty/i)
  })

  it('rejects negative integers', () => {
    expect(() => parseFeeInput('-100')).toThrow(/negative/i)
  })

  it('rejects non-integer values (decimals, currency symbols, comma decimals)', () => {
    expect(() => parseFeeInput('3000.5')).toThrow(/integer/i)
    expect(() => parseFeeInput('$3000')).toThrow(/integer/i)
    expect(() => parseFeeInput('3000,00')).toThrow(/integer/i)
  })

  it('rejects non-numeric strings', () => {
    expect(() => parseFeeInput('abc')).toThrow(/integer/i)
    expect(() => parseFeeInput('NaN')).toThrow(/integer/i)
  })
})

// -----------------------------------------------------------
// deliveryTotal
// -----------------------------------------------------------

describe('deliveryTotal', () => {
  it('sums subtotal + tax + delivery_fee (whole COP pesos)', () => {
    expect(deliveryTotal(10000, 1900, 3000)).toBe(14900)
    expect(deliveryTotal(0, 0, 0)).toBe(0)
    expect(deliveryTotal(47000, 0, 5000)).toBe(52000)
  })

  it('does not apply tax or tip on the delivery fee', () => {
    // Same as pay_order: subtotal + tax, then add the (untaxed) fee.
    expect(deliveryTotal(10000, 0, 3000)).toBe(13000)
  })

  it('rejects negative subtotal / tax / fee', () => {
    expect(() => deliveryTotal(-1, 0, 0)).toThrow(/negative/i)
    expect(() => deliveryTotal(0, -1, 0)).toThrow(/negative/i)
    expect(() => deliveryTotal(0, 0, -1)).toThrow(/negative/i)
  })
})

// -----------------------------------------------------------
// changeForHint
// -----------------------------------------------------------

describe('changeForHint', () => {
  it('returns cashChangeFor - total when positive (change the courier must carry)', () => {
    expect(changeForHint(47000, 50000)).toBe(3000)
    expect(changeForHint(10000, 15000)).toBe(5000)
  })

  it('returns 0 when cashChangeFor equals total (exact)', () => {
    expect(changeForHint(47000, 47000)).toBe(0)
  })

  it('throws when cashChangeFor is below total (cannot carry negative change)', () => {
    expect(() => changeForHint(50000, 47000)).toThrow(/change/i)
    expect(() => changeForHint(10000, 0)).toThrow(/change/i)
  })

  it('throws when cashChangeFor is negative', () => {
    expect(() => changeForHint(10000, -100)).toThrow(/negative/i)
  })

  it('throws when total is negative', () => {
    expect(() => changeForHint(-1, 10000)).toThrow(/negative/i)
  })
})
describe('suggestedFeeFromConfig', () => {
  it('reads a whole-peso suggestion from business_config', () => {
    expect(suggestedFeeFromConfig('5000')).toBe(5000)
    expect(suggestedFeeFromConfig(' 0 ')).toBe(0)
  })

  it('falls back to no suggestion for a missing, unreadable or malformed value', () => {
    expect(suggestedFeeFromConfig(null)).toBe(0)
    expect(suggestedFeeFromConfig('')).toBe(0)
    expect(suggestedFeeFromConfig('abc')).toBe(0)
    expect(suggestedFeeFromConfig('3000.5')).toBe(0)
    expect(suggestedFeeFromConfig('-1')).toBe(0)
    // Any whole-peso value is accepted; a suggestion is never a crash.
    expect(suggestedFeeFromConfig('1e3')).toBe(1000)
  })
})
