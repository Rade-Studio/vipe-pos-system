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
