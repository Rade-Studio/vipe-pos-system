/**
 * Phone-number helpers for the delivery module.
 *
 * The server CHECK (customers.phone / couriers.phone /
 * order_deliveries.customer_phone) is `^[0-9]{7,15}$`. The
 * Colombian country code is `57`, mobile numbers are exactly 10
 * digits and start with `3`.
 *
 * `normalizePhone` is the registry-safe entry: it strips the
 * formatting characters every Colombian cell-phone book likes to add
 * (spaces, dashes, parens, dots), then conditionally strips a `57`
 * country prefix when the remainder is a 10-digit Colombian mobile
 * so the registry stays single-shape. International numbers (7..15
 * digits, no `57` mobile signature) keep the country prefix verbatim
 * so a non-Colombian number is never silently truncated.
 *
 * `formatPhone` is a display helper for the operator UI: it groups a
 * 10-digit mobile as `310 123 4567` and prefixes `+57` on request.
 */

// -----------------------------------------------------------
// normalizePhone
// -----------------------------------------------------------

const MIN_DIGITS = 7
const MAX_DIGITS = 15
const COUNTRY_CODE = '57'

/**
 * Normalize a phone-number string for the registry.
 *
 * Strips every non-digit, then strips a leading `57` country code
 * ONLY when the remainder is exactly a 10-digit Colombian mobile
 * (3 + 9 digits). Returns the trimmed digit string when 7..15 digits
 * remain, or null when the input carries too few / too many digits
 * or no digits at all.
 *
 * @example normalizePhone('+57 310 123 4567') -> '3101234567'
 * @example normalizePhone('571234567')       -> '571234567' (7 digits, keep 57)
 * @example normalizePhone('12345')           -> null
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 0) return null

  // Strip the country prefix when the rest of the digits is a 10-digit
  // Colombian mobile. This avoids trimming 12-digit international
  // numbers that happen to start with `57`.
  let normalized = digits
  if (
    normalized.startsWith(COUNTRY_CODE) &&
    normalized.length === COUNTRY_CODE.length + 10 &&
    normalized.charAt(COUNTRY_CODE.length) === '3'
  ) {
    normalized = normalized.slice(COUNTRY_CODE.length)
  }

  if (normalized.length < MIN_DIGITS || normalized.length > MAX_DIGITS) return null
  return normalized
}

// -----------------------------------------------------------
// formatPhone
// -----------------------------------------------------------

export interface FormatPhoneOptions {
  /** Prefix with `+57 ` when missing. Default: false. */
  withCountryCode?: boolean
}

/**
 * Display formatter. Groups a 10-digit Colombian mobile as
 * `310 123 4567` (the same grouping the operator reads on incoming
 * calls). Inputs of any other length pass through unchanged so the
 * helper does not silently rewrite a number it does not understand.
 *
 * Always returns the raw digit string when the shape does not fit
 * the 3-3-4 grouping (no surprise parens / dots / dashes).
 */
export function formatPhone(digits: string, options: FormatPhoneOptions = {}): string {
  const withCountry = options.withCountryCode ?? false
  const bare = digits.replace(/\D/g, '')

  if (bare.length === 10 && bare.startsWith('3')) {
    return withCountry
      ? `+${COUNTRY_CODE} ${bare.slice(0, 3)} ${bare.slice(3, 6)} ${bare.slice(6)}`
      : `${bare.slice(0, 3)} ${bare.slice(3, 6)} ${bare.slice(6)}`
  }

  // Already carries the 57 country prefix and is exactly a 10-digit
  // Colombian mobile underneath.
  if (
    bare.length === COUNTRY_CODE.length + 10 &&
    bare.startsWith(COUNTRY_CODE) &&
    bare.charAt(COUNTRY_CODE.length) === '3'
  ) {
    const mobile = bare.slice(COUNTRY_CODE.length)
    return `+${COUNTRY_CODE} ${mobile.slice(0, 3)} ${mobile.slice(3, 6)} ${mobile.slice(6)}`
  }

  return bare
}