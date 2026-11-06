/**
 * Wording of the order details the waiter flow shows (T22, S8): the send time
 * of the lines (order_items.added_at) and the guests.
 */

const pad = (value: number) => String(value).padStart(2, "0")

/** "19:48": 24-hour local time; null without a valid date. */
export function clockTime(date: Date | undefined | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const guestsText = (guests: number | undefined | null): string | null =>
  typeof guests === "number" && guests > 0 ? `${guests} ${guests === 1 ? "persona" : "personas"}` : null

export interface SentGroup<T> {
  /** "19:48", or null for lines without a send time. */
  time: string | null
  lines: T[]
}

/** The sent lines grouped by the minute they went to the kitchen, oldest first; lines without a time go last. */
export function sentGroups<T extends { addedAt?: Date }>(lines: readonly T[]): SentGroup<T>[] {
  const groups = new Map<string | null, { at: number; lines: T[] }>()
  for (const line of lines) {
    const time = clockTime(line.addedAt)
    const at = time ? line.addedAt!.getTime() : Number.POSITIVE_INFINITY
    const group = groups.get(time)
    if (group) {
      group.lines.push(line)
      group.at = Math.min(group.at, at)
    } else groups.set(time, { at, lines: [line] })
  }
  return [...groups.entries()].sort((a, b) => a[1].at - b[1].at).map(([time, group]) => ({ time, lines: group.lines }))
}
