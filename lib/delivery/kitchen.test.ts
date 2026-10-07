import { describe, expect, it } from 'vitest'
import {
  servedOrderMessage,
  groupDineInOrdersByTable,
  hasTable,
  isDeliveryOrder,
  matchesPlaceFilter,
  orderHeading,
  orderPlaceText,
  orderTypeFromRow,
  pendingDeliveryPayments,
  shouldMarkDeliveryReady,
} from './kitchen'
import { DELIVERY_STATUSES } from './types'

describe('orderTypeFromRow', () => {
  it('reads order_type and defaults to dine_in', () => {
    expect(orderTypeFromRow({ order_type: 'delivery' })).toBe('delivery')
    expect(orderTypeFromRow({ order_type: 'dine_in' })).toBe('dine_in')
    expect(orderTypeFromRow({})).toBe('dine_in')
    expect(orderTypeFromRow(null)).toBe('dine_in')
    expect(orderTypeFromRow({ order_type: 'DELIVERY' })).toBe('dine_in')
  })
})

describe('isDeliveryOrder / hasTable', () => {
  it('flags delivery orders', () => {
    expect(isDeliveryOrder({ orderType: 'delivery' })).toBe(true)
    expect(isDeliveryOrder({ orderType: 'dine_in' })).toBe(false)
    expect(isDeliveryOrder({})).toBe(false)
  })

  it('has a table only for a dine-in order with a table id', () => {
    expect(hasTable({ orderType: 'dine_in', tableId: 't1' })).toBe(true)
    expect(hasTable({ tableId: 't1' })).toBe(true)
    expect(hasTable({ orderType: 'delivery', tableId: 't1' })).toBe(false)
    expect(hasTable({ orderType: 'dine_in', tableId: '' })).toBe(false)
    expect(hasTable({ tableId: null })).toBe(false)
  })
})

describe('orderHeading', () => {
  it('labels dine-in orders with the table number', () => {
    expect(orderHeading({ orderType: 'dine_in', tableNumber: 4 })).toBe('Mesa 4')
    expect(orderHeading({ tableNumber: 12 })).toBe('Mesa 12')
  })

  it('labels a dine-in order with an unknown table without "undefined"', () => {
    expect(orderHeading({ orderType: 'dine_in' })).toBe('Mesa ?')
    expect(orderHeading({ orderType: 'dine_in', tableNumber: null })).toBe('Mesa ?')
  })

  it('labels delivery orders with the customer name', () => {
    expect(orderHeading({ orderType: 'delivery' }, { customerName: 'Ana Pérez' })).toBe(
      'DOMICILIO · Ana Pérez',
    )
  })

  it('falls back to DOMICILIO when the delivery row is not loaded or blank', () => {
    expect(orderHeading({ orderType: 'delivery' })).toBe('DOMICILIO')
    expect(orderHeading({ orderType: 'delivery' }, null)).toBe('DOMICILIO')
    expect(orderHeading({ orderType: 'delivery' }, { customerName: '   ' })).toBe('DOMICILIO')
  })

  it('ignores the table number on a delivery order', () => {
    expect(orderHeading({ orderType: 'delivery', tableNumber: 3 }, { customerName: 'Luis' })).toBe(
      'DOMICILIO · Luis',
    )
  })
})

describe('orderPlaceText', () => {
  it('builds the toast fragment for each order kind', () => {
    expect(orderPlaceText({ orderType: 'dine_in', tableNumber: 7 })).toBe('la mesa 7')
    expect(orderPlaceText({ orderType: 'dine_in' })).toBe('una mesa')
    expect(orderPlaceText({ orderType: 'delivery' }, { customerName: 'Ana' })).toBe('el domicilio de Ana')
    expect(orderPlaceText({ orderType: 'delivery' })).toBe('un domicilio')
  })
})

describe('shouldMarkDeliveryReady', () => {
  it('is true only while the kitchen still owns the delivery', () => {
    expect(shouldMarkDeliveryReady('received')).toBe(true)
    expect(shouldMarkDeliveryReady('preparing')).toBe(true)
    for (const status of DELIVERY_STATUSES) {
      if (status === 'received' || status === 'preparing') continue
      expect(shouldMarkDeliveryReady(status)).toBe(false)
    }
  })

  it('is false when the status is unknown', () => {
    expect(shouldMarkDeliveryReady(null)).toBe(false)
    expect(shouldMarkDeliveryReady(undefined)).toBe(false)
  })
})

describe('matchesPlaceFilter', () => {
  const dineIn = { orderType: 'dine_in' as const, tableNumber: 5 }
  const delivery = { orderType: 'delivery' as const }

  it('passes everything without a filter', () => {
    expect(matchesPlaceFilter(dineIn, null)).toBe(true)
    expect(matchesPlaceFilter(delivery, null)).toBe(true)
  })

  it('filters by table number and never matches a delivery order', () => {
    expect(matchesPlaceFilter(dineIn, 5)).toBe(true)
    expect(matchesPlaceFilter(dineIn, 6)).toBe(false)
    expect(matchesPlaceFilter({ orderType: 'dine_in' as const }, 5)).toBe(false)
    expect(matchesPlaceFilter({ ...delivery, tableNumber: 5 }, 5)).toBe(false)
  })

  it('the delivery filter keeps only delivery orders', () => {
    expect(matchesPlaceFilter(delivery, 'delivery')).toBe(true)
    expect(matchesPlaceFilter(dineIn, 'delivery')).toBe(false)
  })
})

describe('groupDineInOrdersByTable', () => {
  it('groups dine-in orders and drops delivery and partial orders', () => {
    const orders = [
      { id: 'a', tableId: 't1', orderType: 'dine_in' as const },
      { id: 'b', tableId: 't1' },
      { id: 'c', tableId: 't2', orderType: 'dine_in' as const },
      { id: 'd', tableId: '', orderType: 'delivery' as const },
      { id: 'e', tableId: 't2', isPartialOrder: true },
      { id: 'f', tableId: '' },
    ]
    const grouped = groupDineInOrdersByTable(orders)
    expect(Object.keys(grouped).sort()).toEqual(['t1', 't2'])
    expect(grouped.t1.map((o) => o.id)).toEqual(['a', 'b'])
    expect(grouped.t2.map((o) => o.id)).toEqual(['c'])
  })

  it('returns an empty record for no orders', () => {
    expect(groupDineInOrdersByTable([])).toEqual({})
  })
})

describe('pendingDeliveryPayments', () => {
  const row = (orderId: string, status: (typeof DELIVERY_STATUSES)[number], isPaid: boolean) => ({
    delivery: { orderId, status },
    isPaid,
  })

  it('keeps unpaid rows that are not cancelled, in input order', () => {
    const rows = [
      row('1', 'received', false),
      row('2', 'delivered', false),
      row('3', 'cancelled', false),
      row('4', 'out_for_delivery', true),
      row('5', 'failed', false),
    ]
    expect(pendingDeliveryPayments(rows).map((r) => r.delivery.orderId)).toEqual(['1', '2', '5'])
  })
})

describe('servedOrderMessage', () => {
  it('reports a served table for dine-in orders', () => {
    expect(servedOrderMessage({ delivery: false, deliveryReady: false })).toBe(
      'Todos los productos fueron entregados y la mesa quedó servida.',
    )
  })

  it('reports a ready delivery only once the server confirmed it', () => {
    expect(servedOrderMessage({ delivery: true, deliveryReady: true })).toBe(
      'Todos los productos fueron entregados y el domicilio quedó listo para despachar.',
    )
  })

  it('never claims a delivery is ready when marking it was skipped or failed', () => {
    expect(servedOrderMessage({ delivery: true, deliveryReady: false })).toBe(
      'Todos los productos fueron entregados.',
    )
  })
})
