import { describe, expect, it } from 'vitest'
import { newIdempotencyKey } from './idempotency'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newIdempotencyKey', () => {
  it('uses crypto.randomUUID when available (secure contexts)', () => {
    const key = newIdempotencyKey({
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: (a) => a,
    })
    expect(key).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('builds a canonical v4 uuid from getRandomValues on plain-http LAN origins', () => {
    let seed = 7
    const key = newIdempotencyKey({
      getRandomValues: (a) => {
        for (let i = 0; i < a.length; i++) a[i] = (seed = (seed * 31 + 11) % 256)
        return a
      },
    })
    expect(key).toMatch(UUID_V4)
  })

  it('produces different keys on consecutive calls', () => {
    const real = globalThis.crypto
    expect(newIdempotencyKey(real)).not.toBe(newIdempotencyKey(real))
  })

  it('refuses to generate a key without a randomness source', () => {
    expect(() => newIdempotencyKey(undefined)).toThrow(/random/i)
  })
})
