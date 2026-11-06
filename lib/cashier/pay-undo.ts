/**
 * The 10 s payment undo (T24). "Registrar $X y cerrar" opens a window; the
 * pay request goes out only when it ends or on "Cerrar ahora". Undo, leaving
 * the screen or switching order during the window sends nothing: the draft
 * is kept here (in memory, for this browser tab) by order and bill, and the
 * panel takes it back when the same order with the same bill opens again.
 */
export const PAY_UNDO_MS = 10_000

/** "0:08": seconds left, rounded up. */
export function countdownLabel(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

const kept = new Map<string, { signature: string; draft: unknown }>()

export function keepPendingDraft<T>(orderId: string, signature: string, draft: T): void {
  kept.set(orderId, { signature, draft })
}

/** The kept draft for this order when its bill is unchanged; returned once. */
export function takePendingDraft<T>(orderId: string, signature: string): T | null {
  const entry = kept.get(orderId)
  if (!entry) return null
  kept.delete(orderId)
  return entry.signature === signature ? (entry.draft as T) : null
}
