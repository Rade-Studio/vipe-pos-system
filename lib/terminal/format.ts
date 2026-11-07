/** Labels of the shared terminal and the PIN screens (F4). */

/** A lock end or any instant as a 24-hour local clock: "12:49". */
export function clockTime(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** Time left of an identification as m:ss, rounded up to the second ("4:12"); never negative. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** Up to two initials of a name ("Laura Gómez" → "LG"); "?" for a blank name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  return words
    .slice(0, 2)
    .map((word) => word[0].toLocaleUpperCase("es-CO"))
    .join("")
}
