"use client"

import { useId, useState } from "react"
import type { AdminCategoryNode } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import { CategoryIcon, colorClasses } from "./tones"

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What the waiter's picker shows of a category: active subcategories and active dishes only. */
function waiterView(node: AdminCategoryNode) {
  const subcategories = node.subcategories
    .filter((s) => s.subcategory.active)
    .map((s) => ({ ...s, dishes: s.dishes.filter((dish) => dish.active) }))
  const dishes = [...node.looseDishes, ...node.subcategories.flatMap((s) => s.dishes)]
    .filter((dish) => dish.active)
    .sort((a, b) => a.name.localeCompare(b.name, "es"))
  return { subcategories, dishes }
}

function Tile({
  node,
  title,
  detail,
  icon = true,
  selected = false,
}: {
  node: AdminCategoryNode
  title: string
  detail: string
  icon?: boolean
  selected?: boolean
}) {
  const tone = colorClasses(node.category.color)
  return (
    <li
      data-selected={selected ? "true" : undefined}
      className={cn(
        "relative flex min-h-[6.5rem] min-w-0 flex-col gap-1.5 overflow-hidden rounded-card border-[1.5px] py-2.5 pl-3.5 pr-2.5",
        tone.fill,
        selected && "shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--accent)]",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[5px]", tone.bar)} />
      {icon && (
        <span
          aria-hidden
          className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-card shadow-[inset_0_0_0_1px_currentColor]"
        >
          <CategoryIcon name={node.category.icon} className="h-[18px] w-[18px]" />
        </span>
      )}
      <b className={cn("break-words text-[14.5px] font-semibold leading-tight text-fg [overflow-wrap:anywhere]", icon && "mt-auto")}>
        {title}
      </b>
      <span className="text-xs text-fg-2">{detail}</span>
    </li>
  )
}

/**
 * "Así lo ve el mesero": the waiter's step 1 (categories) and step 2
 * (subcategories, or the dishes straight away for a category without them),
 * from the same colours, icons and order the editor saves.
 */
export function WaiterPreview({ nodes, selected }: { nodes: AdminCategoryNode[]; selected: AdminCategoryNode | null }) {
  const titleId = useId()
  const [step, setStep] = useState<1 | 2>(1)
  const active = nodes.filter((node) => node.category.active)
  const shown = step === 2 && selected ? selected : null
  const view = shown ? waiterView(shown) : null

  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-2">
      <h2 id={titleId} className="text-base font-semibold">
        Así lo ve el mesero
      </h2>
      <p className="text-sm text-muted-fg">Vista previa de lo guardado, con los mismos colores, íconos y orden.</p>
      <div className="grid gap-2.5 rounded-card-lg border border-line bg-canvas p-3">
        <div role="group" aria-label="Paso de la vista previa" className="flex min-w-0 flex-wrap gap-1 justify-self-start rounded-pill border border-line bg-card p-[3px]">
          {[
            { value: 1 as const, label: "Paso 1" },
            ...(selected
              ? [
                  {
                    value: 2 as const,
                    label: selected.skipsSubcategoryStep ? `Platos de ${selected.category.name}` : `Paso 2 · ${selected.category.name}`,
                  },
                ]
              : []),
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={(shown ? 2 : 1) === option.value}
              onClick={() => setStep(option.value)}
              className={cn(
                "inline-flex min-h-11 min-w-0 items-center rounded-pill px-3 text-[13px] font-medium text-fg-2",
                "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus",
                "aria-pressed:bg-brand-tint aria-pressed:text-fg aria-pressed:shadow-[inset_0_0_0_1px_var(--accent-line)]",
              )}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
        <p className="flex flex-wrap gap-1.5 text-[12.5px] text-fg-2">
          {shown ? (
            <>
              <span>{shown.category.name}</span>
              <span aria-hidden className="text-muted-fg">›</span>
              <span>{shown.skipsSubcategoryStep ? "salta a 3 Plato" : "2 Subcategoría"}</span>
            </>
          ) : (
            <span>1 Categoría › 2 Subcategoría › 3 Plato › 4 Agregar</span>
          )}
        </p>
        {shown && view ? (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
            {shown.skipsSubcategoryStep
              ? view.dishes.map((dish) => (
                  <Tile key={dish.id} node={shown} title={dish.name} detail={formatCurrency(dish.price)} icon={false} />
                ))
              : view.subcategories.map((s) => (
                  <Tile
                    key={s.subcategory.id}
                    node={shown}
                    title={s.subcategory.name}
                    detail={plural(s.dishes.length, "plato", "platos")}
                  />
                ))}
          </ul>
        ) : (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
            {active.map((node) => {
              const view = waiterView(node)
              return (
                <Tile
                  key={node.category.id}
                  node={node}
                  title={node.category.name}
                  selected={node.category.id === selected?.category.id}
                  detail={
                    node.skipsSubcategoryStep
                      ? `${plural(view.dishes.length, "plato", "platos")} · directo`
                      : plural(view.subcategories.length, "subcategoría", "subcategorías")
                  }
                />
              )
            })}
          </ul>
        )}
        {(shown ? (shown.skipsSubcategoryStep ? view?.dishes.length : view?.subcategories.length) : active.length) === 0 && (
          <p className="text-sm text-muted-fg">Nada que mostrar todavía en este paso.</p>
        )}
      </div>
    </section>
  )
}
