"use client"

import { ChevronDown, ChevronUp, Link2, Trash2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { InventoryItem } from "@/lib/api/inventory/types"
import type { ModifierOptionDraft } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"

export interface OptionRowDraft extends ModifierOptionDraft {
  /** Stable React key; the option id once saved. */
  key: string
  id?: string
  /** "Descontar un ingrediente" was opened. */
  linked: boolean
}

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
const iconButton = cn(
  "grid h-11 w-11 shrink-0 place-items-center rounded-pill border border-line bg-card text-fg disabled:text-muted-fg disabled:opacity-60",
  focusRing,
)
export const nativeSelect = cn(
  "h-11 min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-[15px] text-fg",
  focusRing,
)

/** One option of a group: name, price added to the dish, an optional ingredient it deducts, and its place in the list. */
export function ModifierOptionRow({
  option,
  index,
  total,
  ingredients,
  onChange,
  onMove,
  onRemove,
}: {
  option: OptionRowDraft
  index: number
  total: number
  ingredients: readonly InventoryItem[]
  onChange: (patch: Partial<OptionRowDraft>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const n = index + 1
  const offered = ingredients.filter((item) => item.isActive || item.id === option.ingredientId)
  const unit = ingredients.find((item) => item.id === option.ingredientId)?.unit
  return (
    <li className="grid min-w-0 gap-2 rounded-xl border border-line bg-card p-2">
      <div className="flex min-w-0 gap-2">
        <Input
          aria-label={`Nombre de la opción ${n}`}
          value={option.name}
          placeholder="Ej.: Queso cheddar"
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-11 min-w-0 flex-1 text-[15px]"
        />
        <div className="relative w-[7.5rem] shrink-0 max-[380px]:w-24">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg">
            +$
          </span>
          <Input
            aria-label={`Precio de la opción ${n}`}
            inputMode="numeric"
            value={option.price}
            onChange={(e) => onChange({ price: e.target.value })}
            className="h-11 pl-8 text-right text-[15px] tabular-nums"
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {option.linked || option.ingredientId ? (
          <div className="flex min-w-0 basis-full items-center gap-2 text-[13px] text-fg-2">
            <span className="max-sm:hidden">Descuenta</span>
            <select
              aria-label={`Ingrediente de la opción ${n}`}
              value={option.ingredientId}
              onChange={(e) => onChange({ ingredientId: e.target.value })}
              className={cn(nativeSelect, "w-0 flex-1")}
            >
              <option value="">Descuenta: elige un ingrediente…</option>
              {offered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Input
              aria-label={`Cantidad de la opción ${n}`}
              inputMode="decimal"
              value={option.ingredientQty}
              placeholder="0"
              onChange={(e) => onChange({ ingredientQty: e.target.value })}
              className="h-11 w-16 shrink-0 px-2 text-right tabular-nums sm:w-20"
            />
            {unit && <span className="max-w-16 shrink-0 truncate">{unit}</span>}
            <button
              type="button"
              aria-label={`Quitar ingrediente de la opción ${n}`}
              onClick={() => onChange({ linked: false, ingredientId: "", ingredientQty: "" })}
              className={cn(iconButton, "border-transparent bg-transparent")}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label={`Descontar un ingrediente en la opción ${n}`}
            onClick={() => onChange({ linked: true })}
            className={cn("inline-flex min-h-11 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-semibold text-brand", focusRing)}
          >
            <Link2 className="h-4 w-4 shrink-0" aria-hidden />
            Descontar un ingrediente<span className="-ml-0.5 max-sm:hidden">(opcional)</span>
          </button>
        )}
        <div className="ml-auto flex shrink-0 gap-1.5">
          <button type="button" aria-label={`Subir opción ${n}`} disabled={index === 0} onClick={() => onMove(-1)} className={iconButton}>
            <ChevronUp className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button type="button" aria-label={`Bajar opción ${n}`} disabled={index === total - 1} onClick={() => onMove(1)} className={iconButton}>
            <ChevronDown className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Quitar opción ${n}`}
            onClick={onRemove}
            className={cn(iconButton, "text-status-danger-fg")}
          >
            <Trash2 className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  )
}
