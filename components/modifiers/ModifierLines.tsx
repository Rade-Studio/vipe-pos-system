import { modifierLabel, modifiersExtra } from "@/lib/modifiers/rules"
import { cn } from "@/lib/utils"
import type { OrderItemModifier } from "@/types"
import { formatCurrency } from "@/utils/helpers"

/**
 * The options of a line under its dish (F7, S6): "+ Queso cheddar $3.000",
 * "Término: Medio". With `unitPrice`, a last row "$22.000 + $7.000 = $29.000 c/u".
 */
export function ModifierLines({
  modifiers,
  unitPrice,
  className,
}: {
  modifiers: readonly OrderItemModifier[] | undefined
  unitPrice?: number
  className?: string
}) {
  if (!modifiers?.length) return null
  const extra = modifiersExtra(modifiers)
  return (
    <ul aria-label="Opciones" className={cn("col-span-full grid min-w-0 gap-0.5 text-[13px] text-fg-2", className)}>
      {modifiers.map((modifier) => (
        <li key={modifier.optionId} className="flex min-w-0 justify-between gap-2">
          <span className="min-w-0 [overflow-wrap:anywhere]">{modifierLabel(modifier)}</span>
          {modifier.price > 0 && <span className="flex-none tabular-nums">{formatCurrency(modifier.price)}</span>}
        </li>
      ))}
      {unitPrice !== undefined && (
        <li className="tabular-nums text-muted-fg">
          {formatCurrency(unitPrice - extra)} + {formatCurrency(extra)} = {formatCurrency(unitPrice)} c/u
        </li>
      )}
    </ul>
  )
}
