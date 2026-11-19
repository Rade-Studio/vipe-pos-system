/**
 * H-029: the staff password rule, the same as the API's
 * (apps/api/src/staff/staff.dto.ts `password`, COMMON_PASSWORDS): at least 8
 * characters, letters plus a number, symbol or space (a passphrase passes),
 * and not a common password. The API answers 422 with the same texts.
 */

export const STAFF_PASSWORD_MESSAGES = {
  short: "La contraseña debe tener al menos 8 caracteres",
  mix: "La contraseña debe combinar letras con números, símbolos o espacios",
  common: "La contraseña es demasiado común; elige otra",
} as const

const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password1", "password12", "password123", "passw0rd", "qwerty123", "qwerty12", "abc12345", "abcd1234", "admin123",
  "admin1234", "contraseña1", "contraseña123", "contrasena1", "contrasena123", "colombia1", "colombia123", "restaurante1",
  "iloveyou1", "welcome1", "1q2w3e4r", "a1b2c3d4",
])

/** The Spanish reason the password is refused, or null when it is acceptable. */
export function staffPasswordError(password: string): string | null {
  if (password.length < 8) return STAFF_PASSWORD_MESSAGES.short
  if (!/\p{L}/u.test(password) || !/[^\p{L}]/u.test(password)) return STAFF_PASSWORD_MESSAGES.mix
  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) return STAFF_PASSWORD_MESSAGES.common
  return null
}
