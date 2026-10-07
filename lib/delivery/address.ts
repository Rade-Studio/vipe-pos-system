/**
 * Address display + default-picker helpers.
 *
 * `formatAddress` produces the one-line Spanish display the kitchen
 * ticket prints (the snapshot on order_deliveries is the source of
 * truth - the operator UI does not need to keep formatting in sync
 * with the registry after the order lands).
 *
 * `pickDefaultAddress` picks the row flagged `is_default = true`
 * when present; otherwise the first row in the registry. The schema
 * enforces at most one default per customer with a partial unique
 * index, so the picker is total: empty -> null, exactly one ->
 * that row.
 */

import type { CustomerAddress } from './types'

export interface AddressInput {
  addressLine: string | null | undefined
  neighborhood?: string | null
  reference?: string | null
}

/**
 * One-line Spanish display. Trims the address line (server CHECK
 * rejects an empty trimmed value), drops empty / whitespace-only
 * neighborhood and reference so a partially-filled registry row
 * never renders stray commas or empty parens.
 *
 * Throws when `addressLine` is empty / whitespace - the server CHECK
 * `length(btrim(address_line)) BETWEEN 1 AND 200` would refuse the
 * same row, so a formatter that silently wrote `''` to the ticket
 * would lie to the kitchen.
 */
export function formatAddress(input: AddressInput): string {
  const address = (input.addressLine ?? '').trim()
  if (address.length === 0) {
    throw new RangeError(
      'formatAddress: address_line must be a non-empty value (the server CHECK enforces the same)',
    )
  }
  const neighborhood = (input.neighborhood ?? '').trim()
  const reference = (input.reference ?? '').trim()
  let line = address
  if (neighborhood.length > 0) line += `, ${neighborhood}`
  if (reference.length > 0) line += ` (${reference})`
  return line
}

/**
 * Pick the address the operator form should pre-select.
 *
 * The schema's `WHERE is_default` partial unique index keeps the
 * registry well-formed, but the picker stays defensive when the
 * registry is empty or when the customer has no row flagged default
 * yet (the operator just saved the customer's first-ever address):
 * in both cases we return the first row, falling back to null only
 * when the list is empty.
 */
export function pickDefaultAddress(addresses: readonly CustomerAddress[]): CustomerAddress | null {
  if (addresses.length === 0) return null
  const flagged = addresses.find((a) => a.isDefault)
  if (flagged) return flagged
  return addresses[0]
}