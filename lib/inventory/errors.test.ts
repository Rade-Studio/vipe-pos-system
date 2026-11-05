import { describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api/errors'

import { InventoryError, toInventoryError } from './errors'

describe('toInventoryError', () => {
  it('maps 22023 to an invalid-input message', () => {
    const e = toInventoryError({ code: '22023', message: 'inventory_adjust: p_quantity must be non-zero' })
    expect(e.code).toBe('22023')
    expect(e.message).toBe('Datos inválidos: revisa los valores ingresados.')
  })

  it('maps known 22023 formula rules to specific messages', () => {
    expect(toInventoryError({ code: '22023', message: 'save_formula: ingredient x appears twice' }).message)
      .toBe('Un ingrediente está repetido en la fórmula.')
    expect(toInventoryError({ code: '22023', message: 'formula cycle: x already uses this preparation' }).message)
      .toBe('La fórmula crea un ciclo: una preparación no puede usarse a sí misma, ni directa ni indirectamente.')
    expect(toInventoryError({ code: '22023', message: 'save_formula: a preparation cannot use itself' }).message)
      .toBe('La fórmula crea un ciclo: una preparación no puede usarse a sí misma, ni directa ni indirectamente.')
  })

  it('maps P0002 and 42501', () => {
    expect(toInventoryError({ code: 'P0002', message: 'x not found' })).toMatchObject({
      code: 'P0002', message: 'El registro no existe o no pertenece a este restaurante.',
    })
    expect(toInventoryError({ code: '42501', message: 'role waiter may not' })).toMatchObject({
      code: '42501', message: 'No tienes permiso para realizar esta acción.',
    })
  })

  it('parses the produce_preparation shortage DETAIL (jsonb array)', () => {
    const e = toInventoryError({
      code: 'P0001',
      message: 'produce_preparation: insufficient stock: Tomate (missing 200 g)',
      details: JSON.stringify([
        { ingredient_id: 'a', name: 'Tomate', unit: 'g', required: 500, available: '300.000', missing: '200.000' },
        { ingredient_id: 'b', name: 'Cebolla', unit: 'g', required: 100, available: 0, missing: 100 },
      ]),
    })
    expect(e.code).toBe('P0001')
    expect(e.shortages).toEqual([
      { itemId: 'a', name: 'Tomate', unit: 'g', required: 500, available: 300, missing: 200 },
      { itemId: 'b', name: 'Cebolla', unit: 'g', required: 100, available: 0, missing: 100 },
    ])
    expect(e.message).toBe('Stock insuficiente: Tomate (faltan 200 g), Cebolla (faltan 100 g).')
  })

  it('parses the single-item shortage DETAIL (jsonb object) from FEFO takes', () => {
    const e = toInventoryError({
      code: 'P0001',
      message: 'insufficient stock: Tomate (missing 2.000 kg)',
      details: '{"ingredient_id": "a", "missing": 2}',
    })
    expect(e.shortages).toEqual([{ itemId: 'a', name: null, unit: null, required: null, available: null, missing: 2 }])
    expect(e.message).toBe('Stock insuficiente: Tomate (missing 2.000 kg)')
  })

  it('maps other P0001 business rules without shortages', () => {
    const e = toInventoryError({ code: 'P0001', message: 'receive_purchase_order: receiving 5 exceeds the pending quantity 2' })
    expect(e.shortages).toBeUndefined()
    expect(e.message).toBe('La cantidad recibida supera la cantidad pendiente.')
    expect(toInventoryError({ code: 'P0001', message: 'produce_preparation: Salsa has no formula' }).message)
      .toBe('La preparación no tiene fórmula.')
    expect(toInventoryError({ code: 'P0001', message: 'apply_inventory_count: count 3 is applied' }).message)
      .toBe('El documento ya no admite esta operación por su estado actual.')
    expect(toInventoryError({ code: 'P0001', message: 'something else' }).message)
      .toBe('La operación no cumple una regla del inventario.')
  })

  it('ignores an unparseable DETAIL', () => {
    const e = toInventoryError({ code: 'P0001', message: 'insufficient stock', details: 'not json' })
    expect(e.shortages).toBeUndefined()
  })

  it('maps unique violations and unknown errors, and is idempotent', () => {
    expect(toInventoryError({ code: '23505', message: 'dup' }).message).toBe('Ya existe un registro con ese código o nombre.')
    const unknown = toInventoryError(new Error('boom'))
    expect(unknown).toMatchObject({ code: 'unknown', message: 'Ocurrió un error inesperado. Intenta de nuevo.' })
    expect(unknown).toBeInstanceOf(InventoryError)
    expect(toInventoryError(unknown)).toBe(unknown)
    expect(toInventoryError(null).code).toBe('unknown')
  })
})

/** T10: the API error body carries `code`, the verbatim `message` and `details`. */
describe('toInventoryError with an ApiError', () => {
  const apiError = (status: number, body: Record<string, unknown>) =>
    new ApiError(status, 'Error', String(body.message ?? ''), { statusCode: status, ...body })

  it('reads code and verbatim message from the body (fn_name prefix and regexes)', () => {
    const e = toInventoryError(apiError(422, { code: '22023', message: 'save_formula: ingredient x appears twice' }))
    expect(e).toMatchObject({ code: '22023', message: 'Un ingrediente está repetido en la fórmula.' })
    expect(toInventoryError(apiError(422, { code: 'P0001', message: 'apply_inventory_count: count 3 is applied' })).message)
      .toBe('El documento ya no admite esta operación por su estado actual.')
    expect(toInventoryError(apiError(404, { code: 'P0002', message: 'Not found' })).code).toBe('P0002')
    expect(toInventoryError(apiError(409, { code: '23505', message: 'Conflict with existing data' })).code).toBe('23505')
  })

  it('parses the shortages from details', () => {
    const e = toInventoryError(apiError(422, {
      code: 'P0001',
      message: 'produce_preparation: insufficient stock: Tomate (missing 200 g)',
      details: JSON.stringify([{ ingredient_id: 'a', name: 'Tomate', unit: 'g', required: 500, available: 300, missing: 200 }]),
    }))
    expect(e.shortages).toEqual([{ itemId: 'a', name: 'Tomate', unit: 'g', required: 500, available: 300, missing: 200 }])
    expect(e.message).toBe('Stock insuficiente: Tomate (faltan 200 g).')
  })

  it('maps a validation 422 without code to invalid input', () => {
    const e = toInventoryError(apiError(422, { message: 'quantity: Too small: expected number to be >0' }))
    expect(e).toMatchObject({ code: '22023', message: 'Datos inválidos: revisa los valores ingresados.' })
  })

  it('explains a stale purchase order line instead of a generic message', () => {
    const e = toInventoryError(apiError(422, { message: 'lines: lineId must be a line of this purchase order, once' }))
    expect(e).toMatchObject({ code: '22023', message: 'La orden cambió mientras la editabas: ciérrala, ábrela de nuevo y repite el cambio.' })
  })

  it('maps a 403 and a 404 without code to the role and missing-row messages', () => {
    expect(toInventoryError(apiError(403, { message: 'Forbidden resource' })).code).toBe('42501')
    expect(toInventoryError(apiError(404, { message: 'Not found' })).code).toBe('P0002')
  })

  it('maps a 409 without code to the generic unknown error (only a 23505 with code is a duplicate)', () => {
    expect(toInventoryError(apiError(409, { message: 'Conflict' }))).toMatchObject({
      code: 'unknown', message: 'Ocurrió un error inesperado. Intenta de nuevo.',
    })
  })
})
