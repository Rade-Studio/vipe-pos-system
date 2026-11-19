import { describe, expect, it } from 'vitest'
import { formatCurrency } from '@/utils/helpers'
import { COLOMBIAN_PHONE_ERROR } from './phone'
import {
  COURIERS_QUERY_KEY,
  DEFAULT_FEE_CONFIG_KEY,
  findActivePhoneDuplicate,
  parseDefaultFeeInput,
  toCourierPayload,
  validateCourierInput,
} from './courier-admin'
import type { Courier } from './types'

const courier = (over: Partial<Courier>): Courier => ({
  id: 'c-1',
  name: 'Pedro',
  phone: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

describe('validateCourierInput', () => {
  it('accepts a trimmed name and no phone', () => {
    expect(validateCourierInput({ name: '  Pedro  ', phone: '' })).toEqual([])
  })

  it('accepts a formatted Colombian mobile', () => {
    expect(validateCourierInput({ name: 'Ana', phone: '+57 310 123 4567' })).toEqual([])
  })

  it('rejects an empty or blank name', () => {
    expect(validateCourierInput({ name: '   ', phone: '' })).toEqual([
      'El nombre es obligatorio',
    ])
  })

  it('rejects a name longer than 80 characters after trimming', () => {
    expect(validateCourierInput({ name: ` ${'a'.repeat(80)} `, phone: '' })).toEqual([])
    expect(validateCourierInput({ name: 'a'.repeat(81), phone: '' })).toEqual([
      'El nombre no puede tener más de 80 caracteres',
    ])
  })

  it('rejects a phone that is not a Colombian mobile or landline (H-038)', () => {
    for (const phone of ['12345', 'abc', '1234567', '2101234567', '123456789012']) {
      expect(validateCourierInput({ name: 'Ana', phone })).toEqual([COLOMBIAN_PHONE_ERROR])
    }
  })

  it('accepts a Colombian landline', () => {
    expect(validateCourierInput({ name: 'Ana', phone: '601 123 4567' })).toEqual([])
  })

  it('keeps an unchanged stored phone that predates the Colombian rule', () => {
    expect(validateCourierInput({ name: 'Ana', phone: '1234567' }, '1234567')).toEqual([])
    expect(validateCourierInput({ name: 'Ana', phone: '7654321' }, '1234567')).toEqual([COLOMBIAN_PHONE_ERROR])
  })

  it('reports every error at once', () => {
    expect(validateCourierInput({ name: '', phone: '1' })).toHaveLength(2)
  })
})

describe('toCourierPayload', () => {
  it('trims the name and normalizes the phone', () => {
    expect(toCourierPayload({ name: '  Pedro ', phone: '+57 310-123-4567' })).toEqual({
      name: 'Pedro',
      phone: '3101234567',
    })
  })

  it('maps a blank phone to null', () => {
    expect(toCourierPayload({ name: 'Pedro', phone: '   ' })).toEqual({
      name: 'Pedro',
      phone: null,
    })
  })

  it('throws on input that does not validate', () => {
    expect(() => toCourierPayload({ name: '', phone: '' })).toThrow()
    expect(() => toCourierPayload({ name: 'Pedro', phone: '123' })).toThrow()
  })
})

describe('findActivePhoneDuplicate', () => {
  const list = [
    courier({ id: 'c-1', name: 'Pedro', phone: '3101234567' }),
    courier({ id: 'c-2', name: 'Ana', phone: '3109999999', isActive: false }),
  ]

  it('returns the active courier that already uses the normalized phone', () => {
    expect(findActivePhoneDuplicate('+57 310 123 4567', list)?.id).toBe('c-1')
  })

  it('ignores inactive couriers, the row being edited and blank/invalid phones', () => {
    expect(findActivePhoneDuplicate('3109999999', list)).toBeNull()
    expect(findActivePhoneDuplicate('3101234567', list, 'c-1')).toBeNull()
    expect(findActivePhoneDuplicate('', list)).toBeNull()
    expect(findActivePhoneDuplicate('12', list)).toBeNull()
  })
})

describe('COURIERS_QUERY_KEY', () => {
  it('is the prefix of the dispatch dialog key so one invalidation covers both', () => {
    expect(COURIERS_QUERY_KEY).toEqual(['couriers'])
  })
})

describe('parseDefaultFeeInput', () => {
  it('accepts whole non-negative pesos, ignoring surrounding spaces and thousands dots', () => {
    expect(parseDefaultFeeInput('5000')).toEqual({ ok: true, value: 5000 })
    expect(parseDefaultFeeInput(' 0 ')).toEqual({ ok: true, value: 0 })
    expect(parseDefaultFeeInput('5.000')).toEqual({ ok: true, value: 5000 })
  })

  it('rejects empty, negative, decimal and non-numeric input with a Spanish message', () => {
    for (const raw of ['', '  ', '-1', '4500,5', '12abc', '1e3']) {
      const result = parseDefaultFeeInput(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('Ingresa un valor entero en pesos, mayor o igual a 0')
    }
  })

  it('rejects values beyond the safe integer range', () => {
    expect(parseDefaultFeeInput('99999999999999999').ok).toBe(false)
  })

  it('caps the suggested fee at the delivery fee limit (H-038)', () => {
    expect(parseDefaultFeeInput('200.000')).toEqual({ ok: true, value: 200000 })
    expect(parseDefaultFeeInput('200001')).toEqual({ ok: false, error: `El domicilio no puede superar ${formatCurrency(200000)}` })
  })

  it('uses the business_config key the delivery dialog reads', () => {
    expect(DEFAULT_FEE_CONFIG_KEY).toBe('delivery_default_fee')
  })
})
