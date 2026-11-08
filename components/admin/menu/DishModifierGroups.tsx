"use client"

import { useId } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import type { ModifierGroupDto } from "@/lib/api/catalog"
import { modifierPriceRange, modifierRuleText, moveItem } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { nativeSelect } from "./ModifierOptionRow"
import { plural } from "./WaiterPreview"

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
const iconButton = cn(
  "grid h-11 w-11 shrink-0 place-items-center rounded-pill border border-line bg-card text-fg disabled:text-muted-fg disabled:opacity-60",
  focusRing,
)

/**
 * The dish form's "Modificadores" block (F7, design 01): attach existing
 * groups, order them as the waiter's sheet shows them, and take them off.
 * Groups are created and edited in Menú → Modificadores.
 */
export function DishModifierGroups({
  groups,
  value,
  onChange,
}: {
  /** Every group of the restaurant. */
  groups: readonly ModifierGroupDto[]
  /** The attached group ids, in order. */
  value: readonly string[]
  onChange: (ids: string[]) => void
}) {
  const titleId = useId()
  const pickerId = useId()
  const byId = new Map(groups.map((group) => [group.id, group]))
  const free = groups.filter((group) => !value.includes(group.id))
  const move = (index: number, delta: -1 | 1) => {
    const next = moveItem(value, index, index + delta)
    if (next) onChange(next)
  }
  return (
    <section aria-labelledby={titleId} className="grid min-w-0 gap-3 rounded-lg border p-4 shadow-sm">
      <div className="space-y-0.5">
        <h3 id={titleId} className="text-sm font-medium">
          Modificadores
        </h3>
        <p className="text-xs text-muted-fg">Grupos que el mesero ve al agregar este plato, en este orden.</p>
      </div>
      <ol aria-label="Grupos del plato" className="grid gap-2">
        {value.map((id, index) => {
          const group = byId.get(id)
          const name = group?.name ?? "Grupo"
          return (
            <li key={id} className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card p-1.5 pl-3">
              <span className="grid min-w-[10rem] flex-1 gap-0.5 py-1">
                <b className="break-words text-[15px] font-semibold [overflow-wrap:anywhere]">
                  {index + 1}. <span data-group-name>{name}</span>
                </b>
                {group && (
                  <small className="break-words text-[12.5px] text-muted-fg [overflow-wrap:anywhere]">
                    {modifierRuleText(group)} · {plural(group.options.length, "opción", "opciones")} · {modifierPriceRange(group.options)}
                    {!group.isActive && " · Inactivo"}
                  </small>
                )}
              </span>
              <span className="ml-auto flex shrink-0 gap-1.5">
                <button type="button" aria-label={`Subir ${name}`} disabled={index === 0} onClick={() => move(index, -1)} className={iconButton}>
                  <ChevronUp className="h-[18px] w-[18px]" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${name}`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                  className={iconButton}
                >
                  <ChevronDown className="h-[18px] w-[18px]" aria-hidden />
                </button>
                <button type="button" aria-label={`Quitar ${name} del plato`} onClick={() => onChange(value.filter((v) => v !== id))} className={iconButton}>
                  <X className="h-[18px] w-[18px]" aria-hidden />
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      {value.length === 0 && (
        <p className="text-sm text-muted-fg">Sin modificadores: el mesero agrega el plato directo, con su cantidad.</p>
      )}
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={pickerId} className="text-sm">
          Agregar grupo
        </label>
        <select
          id={pickerId}
          value=""
          disabled={free.length === 0}
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className={cn(nativeSelect, "w-full")}
        >
          <option value="">{free.length === 0 && groups.length > 0 ? "Ya están todos" : "Elige un grupo…"}</option>
          {free.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-fg">
          ¿Algo como “Sin cebolla”? Es una opción de $0 en un grupo. La nota libre del mesero sigue en el pedido.
        </p>
      </div>
    </section>
  )
}
