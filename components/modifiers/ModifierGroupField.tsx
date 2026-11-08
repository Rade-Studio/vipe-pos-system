"use client"

import { Check } from "lucide-react"
import type { DishModifierGroupDto } from "@/lib/api/catalog"
import { counterText, isSingleChoice, ruleText, type ModifierSelection } from "@/lib/modifiers/rules"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"

const FOCUS = "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

interface ModifierGroupFieldProps {
  group: DishModifierGroupDto
  selection: ModifierSelection
  /** The group is still short of its minimum and the waiter tried, or the sheet shows why it is blocked. */
  missing: boolean
  onToggle: (optionId: string) => void
}

/**
 * One group of the modifier sheet (design/modificadores/01): its name, the
 * rule chip and a counter, then radio cards (elige 1) or checkboxes.
 */
export function ModifierGroupField({ group, selection, missing, onToggle }: ModifierGroupFieldProps) {
  const single = isSingleChoice(group)
  const chosen = selection[group.id] ?? []
  const full = !single && group.maxSelect !== null && chosen.length >= group.maxSelect
  const counter = counterText(group, chosen.length)
  const labelId = `mg-${group.id}`
  const required = group.minSelect >= 1
  return (
    <fieldset className={cn("min-w-0 rounded-card border border-line bg-card p-3 md:p-4", missing && "border-status-warning-line")}>
      <legend className="sr-only">{group.name}</legend>
      <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <b id={labelId} className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">
          {group.name}
        </b>
        <span
          className={cn(
            "inline-flex h-6 items-center whitespace-nowrap rounded-pill border px-2.5 text-xs font-semibold",
            required
              ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg"
              : "border-line-strong bg-surface-2 text-fg-2",
          )}
        >
          {ruleText(group)}
        </span>
        {counter && (
          <span className={cn("ml-auto text-sm font-medium tabular-nums", missing ? "text-status-warning-fg" : "text-fg-2")}>{counter}</span>
        )}
      </div>
      <div role={single ? "radiogroup" : "group"} aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
        {group.options.map((option) => {
          const on = chosen.includes(option.id)
          const blocked = full && !on
          return (
            <button
              key={option.id}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              aria-disabled={blocked || undefined}
              onClick={() => onToggle(option.id)}
              className={cn(
                "flex min-h-11 w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-[15px]",
                on ? "border-brand bg-brand-tint shadow-[inset_0_0_0_1px_var(--accent)]" : "border-line-strong bg-surface hover:bg-surface-2",
                blocked && "border-dashed text-muted-fg",
                FOCUS,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid h-5 w-5 flex-none place-items-center border-2",
                  single ? "rounded-full" : "rounded-[6px]",
                  on ? "border-brand bg-brand text-brand-contrast" : "border-line-strong",
                )}
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{option.name}</span>
                <small className="text-sm tabular-nums text-fg-2">{option.price > 0 ? `+${formatCurrency(option.price)}` : formatCurrency(0)}</small>
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
