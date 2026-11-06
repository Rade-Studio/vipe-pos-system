import { describe, expect, it } from 'vitest'
import {
  BOARD_COLUMNS,
  ORDER_STEPS,
  columnRangeLabel,
  courierLoad,
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
