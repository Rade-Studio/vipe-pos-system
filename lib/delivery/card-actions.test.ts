import { describe, expect, it } from 'vitest'
import {
  canRegisterPayment,
  needsPrepaidWarning,
  rejectionMessage,
  validateFailureReason,
} from './card-actions'

describe('canRegisterPayment', () => {
  it('allows any non-cancelled unpaid order for roles that may call pay_order', () => {
    for (const role of ['delivery_operator', 'admin', 'cashier'] as const) {
      for (const status of ['received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'failed'] as const) {
        expect(canRegisterPayment({ status, isPaid: false, role })).toBe(true)
      }
    }
  })

  it('hides the action for paid or cancelled orders', () => {
    expect(canRegisterPayment({ status: 'delivered', isPaid: true, role: 'delivery_operator' })).toBe(false)
    expect(canRegisterPayment({ status: 'cancelled', isPaid: false, role: 'delivery_operator' })).toBe(false)
  })

  it('hides the action for the kitchen (pay_order refuses the role)', () => {
    expect(canRegisterPayment({ status: 'ready', isPaid: false, role: 'kitchen' })).toBe(false)
  })
})

describe('needsPrepaidWarning', () => {
  it('warns only for an unpaid prepaid order', () => {
    expect(needsPrepaidWarning({ paymentMode: 'prepaid', isPaid: false })).toBe(true)
    expect(needsPrepaidWarning({ paymentMode: 'prepaid', isPaid: true })).toBe(false)
    expect(needsPrepaidWarning({ paymentMode: 'cash_on_delivery', isPaid: false })).toBe(false)
  })
})

describe('validateFailureReason', () => {
  it('returns the trimmed reason when it has 1..200 characters', () => {
    expect(validateFailureReason('  No contesta  ')).toEqual({ ok: true, reason: 'No contesta' })
    expect(validateFailureReason('x'.repeat(200))).toEqual({ ok: true, reason: 'x'.repeat(200) })
  })

  it('rejects empty, blank and too long reasons with a Spanish message', () => {
    for (const raw of ['', '   ', 'x'.repeat(201)]) {
      const out = validateFailureReason(raw)
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.message.length).toBeGreaterThan(0)
    }
  })
})

describe('rejectionMessage', () => {
  it('explains a cancel refused because the order has a payment', () => {
    expect(
      rejectionMessage('set_delivery_status: order 1 already has a payment (refunds are out of scope)'),
    ).toBe('No se puede cancelar: el pedido ya tiene un pago registrado')
  })

  it('maps an inactive courier and a stale state to Spanish', () => {
    expect(rejectionMessage('set_delivery_status: courier c1 is not active')).toBe(
      'El domiciliario está inactivo. Elige otro.',
    )
    expect(rejectionMessage("set_delivery_status: delivery for order 1 is already in state 'ready'")).toBe(
      'El domicilio ya cambió de estado. El tablero se actualizará.',
    )
    expect(
      rejectionMessage("set_delivery_status: action 'deliver' is not allowed from state 'ready' (allowed: x)"),
    ).toBe('El domicilio ya cambió de estado. El tablero se actualizará.')
  })

  it('falls back to the server message', () => {
    expect(rejectionMessage('something else')).toBe('something else')
    expect(rejectionMessage('')).toBe('La operación fue rechazada por el servidor')
  })
})
