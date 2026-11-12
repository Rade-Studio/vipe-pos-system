/**
 * Formatting for the guest carta (artboard 01): COP prices as `$42.900`
 * (dot thousands, no decimals, no space) and restaurant times as `10:30 pm`.
 */

export function formatCop(amount: number): string {
  const negative = amount < 0
  const digits = String(Math.round(Math.abs(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${negative ? "−" : ""}$${digits}`
}

/** "22:30" → "10:30 pm", "07:00" → "7:00 am", "12:00" → "12:00 pm". */
export function formatTime(hhmm: string): string {
  const [h, m = "00"] = hhmm.split(":")
  const hour = Number(h)
  if (!Number.isFinite(hour)) return hhmm
  const suffix = hour >= 12 && hour < 24 ? "pm" : "am"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${m.padStart(2, "0")} ${suffix}`
}

/** Logo fallback: "Brasa & Leña" → "B&L", "Café Central" → "CC". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const letters = words
    .filter((w) => w === "&" || /\p{L}|\p{N}/u.test(w[0]))
    .map((w) => (w === "&" ? "&" : w[0].toLocaleUpperCase("es-CO")))
  const joined = letters.join("")
  // "B&L" keeps the ampersand; otherwise at most three letters.
  return joined.includes("&") ? joined.slice(0, 3) : joined.replace(/&/g, "").slice(0, 2)
}
