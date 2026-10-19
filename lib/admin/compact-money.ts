const ONE_DECIMAL = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })

/**
 * Short COP label for chart axes: `$450 k`, `$2,5 M`. Daily sales reach
 * millions, and the full figure does not fit the axis gutter.
 */
export function compactMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${ONE_DECIMAL.format(value / 1_000_000)} M`
  if (abs >= 1_000) return `$${ONE_DECIMAL.format(value / 1_000)} k`
  return `$${ONE_DECIMAL.format(value)}`
}
