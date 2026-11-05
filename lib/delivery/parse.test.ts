import { describe, expect, it } from 'vitest'
import { parseOrderDeliveryRow } from './parse'

// -----------------------------------------------------------
// parseOrderDeliveryRow
// -----------------------------------------------------------

const WIRE_DELIVERY = {
  order_id: '11111111-1111-1111-1111-111111111111',
  restaurant_id: '22222222-2222-2222-2222-222222222222',
  customer_id: '33333333-3333-3333-3333-333333333333',
  customer_name: 'Juan Pérez',
  customer_phone: '3101234567',
  address_line: 'Calle 5',
  neighborhood: 'Centro',
  address_reference: 'portón verde',
  delivery_fee: 3000,
  payment_mode: 'cash_on_delivery',
  cash_change_for: 50000,
  courier_id: '44444444-4444-4444-4444-444444444444',
  delivery_status: 'ready',
  failure_reason: null,
  notes: 'ring twice',
  dispatched_at: null,
  delivered_at: null,
  failed_at: null,
  cancelled_at: null,
  created_at: '2026-10-07T00:00:00.000Z',
  updated_at: '2026-10-07T01:00:00.000Z',
}

describe('parseOrderDeliveryRow', () => {
  it('remaps a snake_case order_deliveries row to camelCase', () => {
    const parsed = parseOrderDeliveryRow(WIRE_DELIVERY)
    expect(parsed).toMatchObject({
      orderId: WIRE_DELIVERY.order_id,
      customerId: WIRE_DELIVERY.customer_id,
      customerName: 'Juan Pérez',
      customerPhone: '3101234567',
      addressLine: 'Calle 5',
      neighborhood: 'Centro',
      addressReference: 'portón verde',
      deliveryFee: 3000,
      paymentMode: 'cash_on_delivery',
      cashChangeFor: 50000,
      courierId: '44444444-4444-4444-4444-444444444444',
      status: 'ready',
      failureReason: null,
      notes: 'ring twice',
      dispatchedAt: null,
      deliveredAt: null,
      failedAt: null,
      cancelledAt: null,
    })
    expect(parsed.createdAt).toBe(WIRE_DELIVERY.created_at)
    expect(parsed.updatedAt).toBe(WIRE_DELIVERY.updated_at)
  })

  it('handles prepaid rows (cashChangeFor must be null)', () => {
    const prepaid = { ...WIRE_DELIVERY, payment_mode: 'prepaid', cash_change_for: null }
    const parsed = parseOrderDeliveryRow(prepaid)
    expect(parsed.paymentMode).toBe('prepaid')
    expect(parsed.cashChangeFor).toBeNull()
  })

  it('throws when required fields are missing', () => {
    const { order_id, ...rest } = WIRE_DELIVERY
    void rest
    expect(() => parseOrderDeliveryRow({ ...WIRE_DELIVERY, order_id: undefined as unknown as string })).toThrow(/order_id/)
    void order_id
  })

  it('throws when delivery_fee is negative', () => {
    const broken = { ...WIRE_DELIVERY, delivery_fee: -1 }
    expect(() => parseOrderDeliveryRow(broken)).toThrow(/delivery_fee/)
  })

  it('throws when delivery_status is not in the server enum', () => {
    const broken = { ...WIRE_DELIVERY, delivery_status: 'not_a_real_status' }
    expect(() => parseOrderDeliveryRow(broken)).toThrow(/delivery_status/)
  })

  it('throws when payment_mode is not in the server enum', () => {
    const broken = { ...WIRE_DELIVERY, payment_mode: 'card' }
    expect(() => parseOrderDeliveryRow(broken)).toThrow(/payment_mode/)
  })
})
