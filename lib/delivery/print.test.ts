import { describe, expect, it } from 'vitest'
import { buildDeliveryPrintInfo } from './print'
import type { DeliveryOrder } from './types'

function deliveryOrder(overrides: Partial<DeliveryOrder> = {}): DeliveryOrder {
  return {
    orderId: 'o-1',
    customerId: 'c-1',
    customerName: 'Ana Perez',
    customerPhone: '3101234567',
    addressLine: 'Calle 10 #5-20',
    neighborhood: 'Centro',
    addressReference: 'Porton verde',
    deliveryFee: 3000,
    paymentMode: 'cash_on_delivery',
    cashChangeFor: 50000,
    courierId: null,
    status: 'received',
    failureReason: null,
    notes: 'Sin cebolla',
    dispatchedAt: null,
    deliveredAt: null,
    failedAt: null,
    cancelledAt: null,
    createdAt: '2026-10-06T12:00:00Z',
    updatedAt: '2026-10-06T12:00:00Z',
    ...overrides,
  }
}

describe('buildDeliveryPrintInfo', () => {
  it('maps the stored snapshot to the print block', () => {
    expect(buildDeliveryPrintInfo(deliveryOrder())).toEqual({
      customerName: 'Ana Perez',
      phone: '3101234567',
      address: 'Calle 10 #5-20, Centro (Porton verde)',
      notes: 'Sin cebolla',
      paymentMode: 'cash_on_delivery',
      cashChangeFor: 50000,
      deliveryFee: 3000,
    })
  })

  it('omits notes and cashChangeFor when they are null or blank', () => {
    const info = buildDeliveryPrintInfo(
      deliveryOrder({ notes: '  ', cashChangeFor: null, paymentMode: 'prepaid' }),
    )
    expect('notes' in info).toBe(false)
    expect('cashChangeFor' in info).toBe(false)
    expect(info.paymentMode).toBe('prepaid')
  })

  it('drops cashChangeFor for prepaid orders even if set', () => {
    const info = buildDeliveryPrintInfo(deliveryOrder({ paymentMode: 'prepaid', cashChangeFor: 20000 }))
    expect('cashChangeFor' in info).toBe(false)
  })
})
