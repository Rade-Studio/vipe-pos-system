const MIN_DIGITS = 7;
const MAX_DIGITS = 15;
const COUNTRY_CODE = '57';

/**
 * The web's registry rule (`lib/delivery/phone.ts` normalizePhone): drop every
 * non-digit, then drop a leading `57` only when the rest is a 10-digit
 * Colombian mobile (starts with 3). 7..15 digits remain, or null. Matches the
 * `^[0-9]{7,15}$` CHECK on customers, couriers and order_deliveries.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith(COUNTRY_CODE) && digits.length === COUNTRY_CODE.length + 10 && digits.charAt(COUNTRY_CODE.length) === '3') {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  return digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS ? digits : null;
}

/** Spanish message for a phone that fails `normalizeColombianPhone` (lib/delivery/phone.ts COLOMBIAN_PHONE_ERROR). */
export const COLOMBIAN_PHONE_MESSAGE =
  'Ingresa un celular de 10 dígitos que empiece por 3 o un fijo de 10 dígitos que empiece por 60 (por ejemplo 3101234567 o 6011234567)';

/**
 * H-074, H-038: the rule for a phone typed now (a new customer, a courier's
 * phone): Colombian mobile `3` + 9 digits or landline `60` + 8 digits, with an
 * optional `57` prefix; the 10 digits or null. Stored phones keep the 7..15
 * CHECK, so lookups use `normalizePhone`.
 */
export function normalizeColombianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === COUNTRY_CODE.length + 10 && digits.startsWith(COUNTRY_CODE)) {
    digits = digits.slice(COUNTRY_CODE.length);
  }
  return /^(3\d{9}|60\d{8})$/.test(digits) ? digits : null;
}
