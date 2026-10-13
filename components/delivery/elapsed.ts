/**
 * Human-friendly "hace X min / X h Y min" labels for the time elapsed
 * since a delivery entered its current state. No i18n string bundles;
 * the operator board is Spanish by copy and the labels are stable
 * across re-renders (the parent React tree uses the same minute key).
 */
export function formatElapsedMinutes(fromIso: string, nowMs: number = Date.now()): string {
  const from = Date.parse(fromIso)
  if (!Number.isFinite(from)) return '—'
  const diffMs = Math.max(0, nowMs - from)
  const totalMin = Math.floor(diffMs / 60000)
  if (totalMin < 1) return 'hace un momento'
  if (totalMin < 60) return `hace ${totalMin} min`
  const hours = Math.floor(totalMin / 60)
  const min = totalMin % 60
  return min === 0 ? `hace ${hours} h` : `hace ${hours} h ${min} min`
}