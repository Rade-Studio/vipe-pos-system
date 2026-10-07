/**
 * Minimal subset of the Web Crypto API the key generator needs. `randomUUID`
 * only exists in secure contexts (HTTPS or localhost), so a POS opened over
 * plain http on the LAN falls back to `getRandomValues`, which is available in
 * every context.
 */
export interface RandomSource {
  randomUUID?: () => string
  getRandomValues: <T extends Uint8Array>(array: T) => T
}

/**
 * Idempotency key for pay_order: a canonical RFC 4122 v4 uuid. Throws when no
 * randomness source exists, because a constant key would make every later
 * payment of the tenant replay the first one.
 */
export function newIdempotencyKey(source: RandomSource | undefined): string {
  if (source && typeof source.randomUUID === 'function') {
    return source.randomUUID()
  }
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('No secure random source available to build an idempotency key')
  }

  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
