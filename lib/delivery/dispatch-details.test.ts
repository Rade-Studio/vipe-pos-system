import { describe, expect, it } from 'vitest'

import {
  COURIER_LOCATION_MAX,
  MAX_COURIER_ETA_MINUTES,
  canReturnCourier,
  courierEtaAt,
  courierEtaIn,
  normalizeCourierLocation,
} from './dispatch-details'
import type { DeliveryOrder } from './types'

/**
 * T19 (S8): the operator types the courier's ETA and location at dispatch (no
 * courier GPS) and records the return. The server is authoritative
 * (set_delivery_status / return_courier); these helpers keep the form from
 * sending what the server would refuse.
 */

const NOW = new Date('2026-11-06T18:00:00.000Z')

describe('courierEtaIn', () => {
  it('turns whole minutes from now into an ISO instant', () => {
    expect(courierEtaIn(25, NOW)).toBe('2026-11-06T18:25:00.000Z')
    expect(courierEtaIn(MAX_COURIER_ETA_MINUTES, NOW)).toBe('2026-11-07T00:00:00.000Z')
  })

  it('refuses 0, negatives, fractions and more than 6 hours', () => {
    for (const minutes of [0, -5, 2.5, MAX_COURIER_ETA_MINUTES + 1, Number.NaN]) {
      expect(() => courierEtaIn(minutes, NOW)).toThrow(RangeError)
    }
  })
})

describe('normalizeCourierLocation', () => {
  it('trims; blank means not captured (null)', () => {
    expect(normalizeCourierLocation('  Laureles ')).toBe('Laureles')
    expect(normalizeCourierLocation('   ')).toBeNull()
    expect(normalizeCourierLocation(null)).toBeNull()
    expect(normalizeCourierLocation(undefined)).toBeNull()
  })

  it('refuses more than 60 characters after trimming', () => {
    expect(normalizeCourierLocation(` ${'x'.repeat(COURIER_LOCATION_MAX)} `)).toBe('x'.repeat(60))
    expect(() => normalizeCourierLocation('x'.repeat(61))).toThrow(RangeError)
  })
})

describe('canReturnCourier', () => {
  const base = { status: 'delivered', returnedAt: null } as Pick<DeliveryOrder, 'status' | 'returnedAt'>

  it('is true for a delivered or failed delivery whose courier has not returned', () => {
    expect(canReturnCourier(base)).toBe(true)
    expect(canReturnCourier({ ...base, status: 'failed' })).toBe(true)
    expect(canReturnCourier({ status: 'delivered' })).toBe(true)
  })

  it('is false once returned and for every other state', () => {
    expect(canReturnCourier({ ...base, returnedAt: '2026-11-06T18:30:00.000Z' })).toBe(false)
    for (const status of ['received', 'preparing', 'ready', 'out_for_delivery', 'cancelled'] as const) {
      expect(canReturnCourier({ ...base, status })).toBe(false)
    }
  })
})

describe('courierEtaAt (T25: "vuelve ~19:55" time picker)', () => {
  // Local wall-clock dates, so the test holds in any time zone.
  const now = new Date(2026, 10, 6, 18, 0)

  it('turns a time of day into the next instant at that time', () => {
    expect(courierEtaAt('19:55', now)).toEqual({ ok: true, eta: new Date(2026, 10, 6, 19, 55).toISOString() })
    expect(courierEtaAt('00:00', new Date(2026, 10, 6, 22, 30))).toEqual({
      ok: true,
      eta: new Date(2026, 10, 7, 0, 0).toISOString(),
    })
  })

  it('accepts exactly 6 hours ahead and refuses later, now, or an earlier time', () => {
    expect(courierEtaAt('00:00', now)).toEqual({ ok: true, eta: new Date(2026, 10, 7, 0, 0).toISOString() })
    const refused = { ok: false, error: 'Elige una hora dentro de las próximas 6 horas.' }
    expect(courierEtaAt('00:01', now)).toEqual(refused)
    expect(courierEtaAt('18:00', now)).toEqual(refused)
    expect(courierEtaAt('17:59', now)).toEqual(refused)
  })

  it('blank is not captured; a malformed time is refused', () => {
    expect(courierEtaAt('', now)).toEqual({ ok: true, eta: null })
    expect(courierEtaAt('  ', now)).toEqual({ ok: true, eta: null })
    expect(courierEtaAt('25:00', now)).toEqual({ ok: false, error: 'Escribe la hora como 19:55.' })
    expect(courierEtaAt('7pm', now)).toEqual({ ok: false, error: 'Escribe la hora como 19:55.' })
  })
})
