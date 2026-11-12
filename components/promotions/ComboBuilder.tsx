"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Plus } from "lucide-react"

import type { MenuTreeDishDto } from "@/lib/api/catalog"
import type { PromotionDto } from "@/lib/api/promotions"
import { comboSavingText, type CartCombo } from "@/lib/promotions/waiter"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { Button } from "@/components/ui/button"

const FOCUS = "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

interface ComboBuilderProps {
  promotion: PromotionDto
  /** The menu's dishes by id: names and list prices of the options. */
  dishes: ReadonlyMap<string, MenuTreeDishDto>
  /** End of the current window ("15:00"); null = all day. */
  endsAt?: string | null
  onAdd: (combo: CartCombo) => void
}

/**
 * The combo builder (S12): "Elige 1 de cada grupo", each option with its
 * "Suelto $X", then "Por separado $X · ahorra $Y" and "Agregar menú · $P".
 * It takes the focus on open; "Atrás" of the step bar closes it.
 */
export function ComboBuilder({ promotion, dishes, endsAt, onAdd }: ComboBuilderProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [picked, setPicked] = useState<Record<string, string>>({})
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  const comboPrice = promotion.comboPrice ?? 0
  const groups = promotion.comboGroups.map((group) => ({
    ...group,
    options: group.dishIds.flatMap((id) => {
      const dish = dishes.get(id)
      return dish ? [dish] : []
    }),
  }))
  const choices = groups.flatMap((group) => {
    const dish = group.options.find((option) => option.id === picked[group.id])
    return dish ? [{ groupId: group.id, dishId: dish.id, name: dish.name, price: dish.price }] : []
  })
  const missing = groups.length - choices.length
  const listPrice = choices.reduce((sum, choice) => sum + choice.price, 0)
  const saving = comboSavingText(listPrice, comboPrice)

  return (
    <div className="grid max-w-[760px] gap-4">
      <div className="relative flex min-w-0 items-center justify-between gap-3 overflow-hidden rounded-[20px] border-[1.5px] border-status-warning-line bg-status-warning-bg py-3.5 pl-5 pr-4">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-status-warning-fg" />
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold leading-tight outline-none [overflow-wrap:anywhere]">
            {promotion.name}
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-2">Elige 1 de cada grupo{endsAt ? ` · hasta las ${endsAt}` : ""}</p>
        </div>
        <span className="flex-none text-[22px] font-bold tabular-nums">{formatCurrency(comboPrice)}</span>
      </div>

      {groups.map((group, index) => {
        const chosen = picked[group.id] != null
        return (
          <section key={group.id} aria-labelledby={`combo-group-${group.id}`}>
            <h3 id={`combo-group-${group.id}`} className="mb-2 flex items-center gap-2 text-[15px] font-semibold">
              {index + 1} · {group.name}
              <span className={cn("text-xs font-medium", chosen ? "text-status-ok-fg" : "text-muted-fg")}>
                {chosen ? "✓ Elegido" : "Elige 1"}
              </span>
            </h3>
            <div role="group" aria-label={group.name} className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {group.options.map((dish) => {
                const pressed = picked[group.id] === dish.id
                return (
                  <button
                    key={dish.id}
                    type="button"
                    aria-pressed={pressed}
                    disabled={!dish.available}
                    onClick={() => setPicked((prev) => ({ ...prev, [group.id]: dish.id }))}
                    className={cn(
                      "grid min-h-16 gap-0.5 rounded-[14px] border-[1.5px] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60",
                      pressed ? "border-brand bg-brand-tint" : "border-line-strong bg-surface",
                      FOCUS,
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      {pressed && <Check className="h-4 w-4 flex-none text-brand-strong" aria-hidden />}
                      {dish.name}
                    </span>
                    <small className="text-[12.5px] tabular-nums text-muted-fg">
                      {dish.available ? `Suelto ${formatCurrency(dish.price)}` : "Agotado"}
                    </small>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
        <span aria-live="polite" className="tabular-nums">
          {missing === 0 ? (
            <>
              {saving.separate}
              {saving.saving && (
                <>
                  {" · "}
                  <span className="font-semibold text-status-ok-fg">{saving.saving}</span>
                </>
              )}
            </>
          ) : (
            `Faltan ${missing} por elegir`
          )}
        </span>
        <Button
          className="h-12 rounded-xl text-base"
          disabled={missing > 0}
          onClick={() => onAdd({ promotionId: promotion.id, comboPrice, listPrice, choices })}
        >
          <Plus className="mr-1.5 h-5 w-5" aria-hidden />
          Agregar menú · <span className="ml-1 tabular-nums">{formatCurrency(comboPrice)}</span>
        </Button>
      </div>
    </div>
  )
}
