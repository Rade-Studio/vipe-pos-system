import { describe, expect, it } from 'vitest'
import {
  BOARD_COLUMNS,
  ORDER_STEPS,
  closedTodayLine,
  columnRangeLabel,
  courierLoad,
  courierStatusLine,
  courierTrips,
  customerHistoryLine,
  deliveryOrderRef,
  lateTone,
  lostConnectionText,
  stateClockStart,
  matchSavedAddress,
  signalAgeLabel,
  groupDeliveries,
  isShortcutTarget,
  shortOrderRef,
  stepForField,
  visibleColumnRange,
} from './console'
import type { DeliveryStatus } from './types'

const row = (orderId: string, status: DeliveryStatus, courierId: string | null = null) => ({
  delivery: { orderId, status, courierId },
})

describe('BOARD_COLUMNS', () => {
  it('lists the five live states in board order', () => {
    expect(BOARD_COLUMNS.map((c) => c.label)).toEqual([
      'Recibido',
      'En preparación',
      'Listo',
      'En camino',
      'Fallido',
    ])
  })
})

describe('groupDeliveries', () => {
  it('puts delivered and cancelled under closed', () => {
    const g = groupDeliveries([row('a', 'received'), row('b', 'delivered'), row('c', 'cancelled'), row('d', 'failed')])
    expect(g.received.map((r) => r.delivery.orderId)).toEqual(['a'])
    expect(g.failed.map((r) => r.delivery.orderId)).toEqual(['d'])
    expect(g.closed.map((r) => r.delivery.orderId)).toEqual(['b', 'c'])
  })
})

describe('courierLoad', () => {
  it('counts only deliveries out for delivery per courier', () => {
    const load = courierLoad([
      row('a', 'out_for_delivery', 'k1'),
      row('b', 'out_for_delivery', 'k1'),
      row('c', 'delivered', 'k1'),
      row('d', 'out_for_delivery', 'k2'),
      row('e', 'ready', null),
    ])
    expect(load.get('k1')).toBe(2)
    expect(load.get('k2')).toBe(1)
    expect(load.has('k3')).toBe(false)
  })
})

describe('visibleColumnRange / columnRangeLabel', () => {
  it('reports the fully visible columns (288 px min, 12 px gap)', () => {
    expect(visibleColumnRange({ scrollLeft: 0, viewport: 900, column: 288, gap: 12, total: 5 })).toEqual({ first: 1, last: 3 })
    expect(visibleColumnRange({ scrollLeft: 600, viewport: 900, column: 288, gap: 12, total: 5 })).toEqual({ first: 3, last: 5 })
  })

  it('never reports past the last column or below one', () => {
    expect(visibleColumnRange({ scrollLeft: 0, viewport: 5000, column: 288, gap: 12, total: 5 })).toEqual({ first: 1, last: 5 })
    expect(visibleColumnRange({ scrollLeft: 0, viewport: 100, column: 288, gap: 12, total: 5 })).toEqual({ first: 1, last: 1 })
  })

  it('formats the counter with an en dash', () => {
    expect(columnRangeLabel({ first: 1, last: 3 }, 5)).toBe('Columnas 1–3 de 5')
    expect(columnRangeLabel({ first: 5, last: 5 }, 5)).toBe('Columna 5 de 5')
  })
})

describe('shortOrderRef', () => {
  it('shows the first six characters of the real id', () => {
    expect(shortOrderRef('3f2a9c1e-0000-4000-8000-000000000000')).toBe('#3F2A9C')
  })
})

describe('order steps', () => {
  it('runs Cliente → Dirección → Productos → Pago → Confirmar', () => {
    expect(ORDER_STEPS.map((s) => s.label)).toEqual(['Cliente', 'Dirección', 'Productos', 'Pago', 'Confirmar'])
  })

  it('maps each validation field to the step that edits it', () => {
    expect(stepForField('phone')).toBe('customer')
    expect(stepForField('customerName')).toBe('customer')
    expect(stepForField('address')).toBe('address')
    expect(stepForField('items')).toBe('products')
    expect(stepForField('cashChangeFor')).toBe('payment')
    expect(stepForField('fee')).toBe('payment')
    expect(stepForField('something-else')).toBe('confirm')
  })
})

describe('isShortcutTarget', () => {
  const el = (tag: string, extra: Partial<HTMLElement> = {}) => ({ tagName: tag, isContentEditable: false, ...extra }) as HTMLElement

  it('accepts plain N outside text fields', () => {
    expect(isShortcutTarget({ key: 'n', target: el('BODY') })).toBe(true)
    expect(isShortcutTarget({ key: 'N', target: el('BUTTON') })).toBe(true)
  })

  it('ignores typing, modifiers and other keys', () => {
    expect(isShortcutTarget({ key: 'n', target: el('INPUT') })).toBe(false)
    expect(isShortcutTarget({ key: 'n', target: el('TEXTAREA') })).toBe(false)
    expect(isShortcutTarget({ key: 'n', target: el('DIV', { isContentEditable: true }) })).toBe(false)
    expect(isShortcutTarget({ key: 'n', ctrlKey: true, target: el('BODY') })).toBe(false)
    expect(isShortcutTarget({ key: 'n', metaKey: true, target: el('BODY') })).toBe(false)
    expect(isShortcutTarget({ key: 'm', target: el('BODY') })).toBe(false)
  })
})

// ---- T25 (S8): what L14 left out, now from stored data -------------------------

describe('deliveryOrderRef', () => {
  it('formats the order number as #D-0412 (four digits at least)', () => {
    expect(deliveryOrderRef({ orderId: 'abc', orderNumber: 412 })).toBe('#D-0412')
    expect(deliveryOrderRef({ orderId: 'abc', orderNumber: 7 })).toBe('#D-0007')
    expect(deliveryOrderRef({ orderId: 'abc', orderNumber: 12345 })).toBe('#D-12345')
  })

  it('falls back to the short id for a row without a number', () => {
    const orderId = 'a1b2c3d4-0000-0000-0000-000000000000'
    expect(deliveryOrderRef({ orderId, orderNumber: null })).toBe('#A1B2C3')
    expect(deliveryOrderRef({ orderId })).toBe('#A1B2C3')
  })
})

describe('lateTone', () => {
  const created = '2026-11-06T18:00:00.000Z'
  const at = (minutes: number) => Date.parse(created) + minutes * 60_000

  it('is late from the threshold and at risk from 60 % of it', () => {
    expect(lateTone({ createdAt: created, status: 'preparing' }, at(26), 45)).toBeNull()
    expect(lateTone({ createdAt: created, status: 'preparing' }, at(27), 45)).toBe('risk')
    expect(lateTone({ createdAt: created, status: 'preparing' }, at(44), 45)).toBe('risk')
    expect(lateTone({ createdAt: created, status: 'preparing' }, at(45), 45)).toBe('late')
  })

  it('rounds the risk boundary up (10 minutes: risk from 6)', () => {
    expect(lateTone({ createdAt: created, status: 'received' }, at(5), 10)).toBeNull()
    expect(lateTone({ createdAt: created, status: 'received' }, at(6), 10)).toBe('risk')
  })

  it('measures the time in the current phase: the road from dispatch, a failure from failed_at', () => {
    const dispatched = '2026-11-06T18:40:00.000Z'
    const road = { createdAt: created, status: 'out_for_delivery' as const, dispatchedAt: dispatched }
    // 60 min since the order, 20 since dispatch: within 45.
    expect(lateTone(road, at(60), 45)).toBeNull()
    expect(lateTone(road, at(40 + 45), 45)).toBe('late')
    const failed = { createdAt: created, status: 'failed' as const, failedAt: '2026-11-06T18:50:00.000Z' }
    expect(lateTone(failed, at(60), 45)).toBeNull()
    expect(lateTone(failed, at(50 + 27), 45)).toBe('risk')
  })

  it('never marks a delivered or cancelled delivery, nor an unparsable date', () => {
    expect(lateTone({ createdAt: created, status: 'delivered' }, at(90), 45)).toBeNull()
    expect(lateTone({ createdAt: created, status: 'cancelled' }, at(90), 45)).toBeNull()
    expect(lateTone({ createdAt: 'x', status: 'ready' }, at(90), 45)).toBeNull()
  })
})

describe('signalAgeLabel', () => {
  it('reads seconds, minutes and hours', () => {
    expect(signalAgeLabel(0)).toBe('hace 0 s')
    expect(signalAgeLabel(2_400)).toBe('hace 2 s')
    expect(signalAgeLabel(59_999)).toBe('hace 59 s')
    expect(signalAgeLabel(60_000)).toBe('hace 1 min')
    expect(signalAgeLabel(3_600_000)).toBe('hace 1 h')
    expect(signalAgeLabel(-5)).toBe('hace 0 s')
  })
})

describe('courierTrips', () => {
  const trip = (
    orderId: string,
    status: DeliveryStatus,
    courierId: string | null,
    extra: { courierEta?: string | null; courierLocation?: string | null; returnedAt?: string | null; dispatchedAt?: string | null } = {},
  ) => ({ delivery: { orderId, status, courierId, ...extra } })

  it('counts the trips on the road with the latest ETA and the last location', () => {
    const trips = courierTrips([
      trip('o1', 'out_for_delivery', 'k1', { courierEta: '2026-11-06T19:40:00.000Z', courierLocation: 'Belén', dispatchedAt: '2026-11-06T19:00:00.000Z' }),
      trip('o2', 'out_for_delivery', 'k1', { courierEta: '2026-11-06T19:55:00.000Z', courierLocation: 'Laureles', dispatchedAt: '2026-11-06T19:10:00.000Z' }),
      trip('o3', 'ready', 'k1'),
    ])
    expect(trips.get('k1')).toEqual({ onRoad: 2, eta: '2026-11-06T19:55:00.000Z', location: 'Laureles', toReturn: [] })
  })

  it('lists delivered and failed trips not yet returned, and none once returned', () => {
    const trips = courierTrips([
      trip('o1', 'delivered', 'k1'),
      trip('o2', 'failed', 'k1'),
      trip('o3', 'delivered', 'k2', { returnedAt: '2026-11-06T19:00:00.000Z' }),
      trip('o4', 'cancelled', 'k3'),
    ])
    expect(trips.get('k1')).toEqual({ onRoad: 0, eta: null, location: null, toReturn: ['o1', 'o2'] })
    expect(trips.get('k2')).toBeUndefined()
    expect(trips.get('k3')).toBeUndefined()
  })
})

describe('courierStatusLine', () => {
  const tz = { timeZone: 'America/Bogota' }
  it('reads "n pedidos en ruta · vuelve 19:55 · Laureles" for a courier out', () => {
    expect(courierStatusLine({ onRoad: 2, eta: '2026-11-07T00:55:00.000Z', location: 'Laureles', toReturn: [] }, tz)).toBe(
      '2 pedidos en ruta · vuelve 19:55 · Laureles',
    )
    expect(courierStatusLine({ onRoad: 1, eta: null, location: null, toReturn: [] }, tz)).toBe('1 pedido en ruta')
  })

  it('reads "De regreso" for a finished trip not yet back and "En el local" otherwise', () => {
    expect(courierStatusLine({ onRoad: 0, eta: null, location: 'Belén', toReturn: ['o1'] }, tz)).toBe('De regreso · Belén')
    expect(courierStatusLine(undefined, tz)).toBe('En el local')
  })
})

describe('closedTodayLine', () => {
  it('splits delivered and cancelled, adds failed and the average', () => {
    expect(closedTodayLine({ deliveredCount: 21, cancelledCount: 2, failedCount: 1, averageDeliveryMinutes: 34 })).toEqual({
      counts: '21 entregados · 2 cancelados · 1 fallido',
      average: 'Promedio de entrega 34 min',
    })
    expect(closedTodayLine({ deliveredCount: 1, cancelledCount: 0, failedCount: 0, averageDeliveryMinutes: null })).toEqual({
      counts: '1 entregado · 0 cancelados · 0 fallidos',
      average: 'Promedio de entrega: sin entregas despachadas',
    })
  })
})

describe('customerHistoryLine', () => {
  const now = Date.parse('2026-11-06T18:00:00.000Z')
  it('reads "14 pedidos · último hace 6 días"', () => {
    expect(customerHistoryLine({ ordersCount: 14, lastOrderAt: '2026-10-31T17:00:00.000Z', lastAddress: null }, now)).toBe(
      '14 pedidos · último hace 6 días',
    )
    expect(customerHistoryLine({ ordersCount: 1, lastOrderAt: '2026-11-06T10:00:00.000Z', lastAddress: null }, now)).toBe(
      '1 pedido · último hoy',
    )
    expect(customerHistoryLine({ ordersCount: 2, lastOrderAt: '2026-11-05T10:00:00.000Z', lastAddress: null }, now)).toBe(
      '2 pedidos · último ayer',
    )
  })

  it('says so for a customer without deliveries', () => {
    expect(customerHistoryLine({ ordersCount: 0, lastOrderAt: null, lastAddress: null }, now)).toBe('Sin pedidos anteriores')
  })
})

describe('matchSavedAddress', () => {
  const saved = [
    { id: 'a1', addressLine: 'Cra 43A # 18 Sur-135', neighborhood: 'El Poblado', reference: null },
    { id: 'a2', addressLine: 'Cl 10 # 32-15', neighborhood: 'Laureles', reference: 'frente al parque' },
  ]
  it('finds the saved address equal to the last one (trimmed, case-insensitive)', () => {
    expect(matchSavedAddress({ addressLine: ' cl 10 # 32-15', neighborhood: 'laureles', reference: 'Frente al parque' }, saved)).toBe('a2')
  })
  it('returns null when none matches', () => {
    expect(matchSavedAddress({ addressLine: 'Cl 10 # 32-15', neighborhood: null, reference: null }, saved)).toBeNull()
  })
})

describe('stateClockStart (T25: the card clock and the late tone)', () => {
  const base = { createdAt: 'c', dispatchedAt: 'd', failedAt: 'f', deliveredAt: 'v', cancelledAt: 'x' }
  it('kitchen phase from the order, road from dispatch, failure from failed_at, closed from its end', () => {
    expect(stateClockStart({ ...base, status: 'received' })).toBe('c')
    expect(stateClockStart({ ...base, status: 'preparing' })).toBe('c')
    expect(stateClockStart({ ...base, status: 'ready' })).toBe('c')
    expect(stateClockStart({ ...base, status: 'out_for_delivery' })).toBe('d')
    expect(stateClockStart({ ...base, status: 'failed' })).toBe('f')
    expect(stateClockStart({ ...base, status: 'delivered' })).toBe('v')
    expect(stateClockStart({ ...base, status: 'cancelled' })).toBe('x')
  })
  it('falls back to the order time when the state timestamp is missing', () => {
    expect(stateClockStart({ createdAt: 'c', status: 'out_for_delivery', dispatchedAt: null })).toBe('c')
    expect(stateClockStart({ createdAt: 'c', status: 'failed' })).toBe('c')
  })
})

describe('lostConnectionText', () => {
  it('names the age of the last signal, or none', () => {
    expect(lostConnectionText(60_000)).toBe('Se perdió la conexión en vivo hace 1 min.')
    expect(lostConnectionText(null)).toBe('Sin conexión en vivo.')
  })
})
