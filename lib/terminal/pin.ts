/**
 * Checks a PIN entry makes before calling the API (F4). The API stays the
 * only judge of weak PINs (its Spanish 422 is shown verbatim); here only the
 * format, with the API's own message, and the repeated entry.
 */
export const PIN_FORMAT_MESSAGE = "El PIN debe tener entre 4 y 6 dígitos"
export const PIN_MISMATCH_MESSAGE = "Los dos PIN no coinciden"
export const PIN_MAX_LENGTH = 6

const PIN_RE = /^\d{4,6}$/

/** The error to show for a new PIN typed twice, or null when it can be sent. */
export function newPinError(pin: string, again: string): string | null {
  if (!PIN_RE.test(pin)) return PIN_FORMAT_MESSAGE
  if (pin !== again) return PIN_MISMATCH_MESSAGE
  return null
}

/** Only digits, at most PIN_MAX_LENGTH: what a PIN field keeps of a keystroke or a paste. */
export function pinDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH)
}
