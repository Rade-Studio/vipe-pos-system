/**
 * Local-date helpers shared by the admin reads.
 *
 * Every admin read that is "a day", "a month" or "the last N days" has to agree
 * with what the screen shows, and the screens are all in local time
 * (`DatePicker` hands over a local `Date`, the invoice prints a local date).
 * Doing the arithmetic here keeps one definition of "start of day" instead of
 * the four copies the views used to carry.
 */

/** `YYYY-MM-DD` in LOCAL time — the cache key for "one day of data". */
export function localDayKey(date: Date | undefined | null): string {
  if (!date || Number.isNaN(date.getTime())) return "current"
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Epoch ms of local midnight for the given date. */
export function startOfLocalDayMs(date: Date): number {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

/** ISO of the first millisecond of the current LOCAL month. */
export function monthStartIso(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  return start.toISOString()
}

/**
 * ISO of local midnight N days back — the `since` bound for a windowed read.
 *
 * A non-positive window is clamped to one day: an unbounded read is exactly
 * what this module exists to prevent (the old popular-dishes read pulled every
 * paid item ever).
 */
export function daysAgoIso(now: Date, days: number): string {
  const start = new Date(now)
  start.setDate(start.getDate() - Math.max(1, Math.floor(days)))
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}