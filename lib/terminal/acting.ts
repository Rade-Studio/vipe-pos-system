/**
 * Acting claim of the staff member identified on a shared terminal (F4). The
 * terminal screen sets it after POST /api/auth/identify and clears it when
 * the identification ends; the API client adds it to every write, where the
 * API swaps the request identity on the order writes and ignores it elsewhere.
 * A plain module value: the order screens never need to know about it.
 */
export const ACTING_HEADER = "X-Vipe-Acting"

let current: string | null = null

export function actingToken(): string | null {
  return current
}

export function setActingToken(token: string): void {
  current = token
}

export function clearActingToken(): void {
  current = null
}
