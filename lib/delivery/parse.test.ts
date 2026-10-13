import { describe, expect, it } from 'vitest'
import {
  parseCourierRow,
  parseCreateDeliveryOrderResult,
  parseCustomerAddressRow,
  parseCustomerRow,
  parseOrderDeliveryRow,
} from './parse'

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

// -----------------------------------------------------------
// parseCustomerRow
// -----------------------------------------------------------

describe('parseCustomerRow', () => {
  const wire = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    phone: '3101234567',
    name: 'Juan Pérez',
    notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }

  it('remaps snake_case to camelCase', () => {
    expect(parseCustomerRow(wire)).toEqual({
      id: wire.id,
      phone: '3101234567',
      name: 'Juan Pérez',
      notes: null,
      createdAt: wire.created_at,
      updatedAt: wire.updated_at,
    })
  })

  it('throws when the phone regex does not match (digits-only, 7..15)', () => {
    expect(() => parseCustomerRow({ ...wire, phone: '+57 310 123' })).toThrow(/phone/)
    expect(() => parseCustomerRow({ ...wire, phone: '123456' })).toThrow(/phone/)
  })

  it('throws when name is empty / whitespace', () => {
    expect(() => parseCustomerRow({ ...wire, name: '' })).toThrow(/name/)
  })
})

// -----------------------------------------------------------
// parseCustomerAddressRow
// -----------------------------------------------------------

describe('parseCustomerAddressRow', () => {
  const wire = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    customer_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    label: 'Casa',
    address_line: 'Calle 5 # 10-20',
    neighborhood: 'Centro',
    reference: 'junto al parque',
    is_default: true,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }

  it('remaps snake_case to camelCase', () => {
    const parsed = parseCustomerAddressRow(wire)
    expect(parsed).toEqual({
      id: wire.id,
      customerId: wire.customer_id,
      label: 'Casa',
      addressLine: 'Calle 5 # 10-20',
      neighborhood: 'Centro',
      reference: 'junto al parque',
      isDefault: true,
      createdAt: wire.created_at,
      updatedAt: wire.updated_at,
    })
  })

  it('tolerates null label / neighborhood / reference', () => {
    const parsed = parseCustomerAddressRow({
      ...wire,
      label: null,
      neighborhood: null,
      reference: null,
      is_default: false,
    })
    expect(parsed.label).toBeNull()
    expect(parsed.neighborhood).toBeNull()
    expect(parsed.reference).toBeNull()
    expect(parsed.isDefault).toBe(false)
  })

  it('throws when address_line is empty', () => {
    expect(() => parseCustomerAddressRow({ ...wire, address_line: '' })).toThrow(/address_line/)
  })
})

// -----------------------------------------------------------
// parseCourierRow
// -----------------------------------------------------------

describe('parseCourierRow', () => {
  const wire = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    restaurant_id: '22222222-2222-2222-2222-222222222222',
    name: 'Pedro Mensajero',
    is_active: true,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }

  it('remaps snake_case to camelCase (phone optional)', () => {
    expect(parseCourierRow(wire)).toEqual({
      id: wire.id,
      name: 'Pedro Mensajero',
      phone: null,
      isActive: true,
      createdAt: wire.created_at,
      updatedAt: wire.updated_at,
    })
  })

  it('preserves a present phone', () => {
    const parsed = parseCourierRow({ ...wire, phone: '3101234567' })
    expect(parsed.phone).toBe('3101234567')
  })

  it('throws when name is empty', () => {
    expect(() => parseCourierRow({ ...wire, name: '' })).toThrow(/name/)
  })

  it('throws when phone does not match 7..15 digits', () => {
    expect(() => parseCourierRow({ ...wire, phone: '+57 310 123 4567' })).toThrow(/phone/)
  })
})

// -----------------------------------------------------------
// parseCreateDeliveryOrderResult
// -----------------------------------------------------------

describe('parseCreateDeliveryOrderResult', () => {
  const wire = {
    order_id: '11111111-1111-1111-1111-111111111111',
    customer_id: '22222222-2222-2222-2222-222222222222',
    address_id: '33333333-3333-3333-3333-333333333333',
    delivery: WIRE_DELIVERY,
  }

  it('remaps snake_case to camelCase', () => {
    const parsed = parseCreateDeliveryOrderResult(wire)
    expect(parsed.orderId).toBe(wire.order_id)
    expect(parsed.customerId).toBe(wire.customer_id)
    expect(parsed.addressId).toBe(wire.address_id)
    expect(parsed.delivery.status).toBe('ready')
    expect(parsed.delivery.deliveryFee).toBe(3000)
  })

  it('throws when delivery is missing', () => {
    const broken = { ...wire, delivery: null }
    expect(() => parseCreateDeliveryOrderResult(broken)).toThrow(/object|delivery/)
  })

  it('throws when order_id is missing', () => {
    const broken = { ...wire }
    delete (broken as { order_id?: string }).order_id
    expect(() => parseCreateDeliveryOrderResult(broken)).toThrow(/order_id/)
  })
})