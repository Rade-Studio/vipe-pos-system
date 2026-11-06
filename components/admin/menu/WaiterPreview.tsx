"use client"

import { useEffect, useId, useState } from "react"
import type { DishDto } from "@/lib/api/catalog"
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
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"))
  return { subcategories, dishes }
}

function Tile({
  node,
  title,
  detail,
  icon = true,
  selected = false,
  onOpen,
}: {
  node: AdminCategoryNode
  title: string
  detail: string
  icon?: boolean
  selected?: boolean
  /** The next preview step behind this tile, as the waiter's tap. */
  onOpen?: () => void
}) {
  const tone = colorClasses(node.category.color)
  const content = (
    <>
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
    </>
  )
  const body = "relative flex min-h-[6.5rem] min-w-0 flex-col gap-1.5 overflow-hidden py-2.5 pl-3.5 pr-2.5 text-left"
  return (
    <li
      data-selected={selected ? "true" : undefined}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-card border-[1.5px]",
        tone.fill,
        selected && "shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--accent)]",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            body,
            "h-full w-full rounded-card focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focus",
          )}
        >
          {content}
        </button>
      ) : (
        <div className={body}>{content}</div>
      )}
    </li>
  )
}

/** The waiter's step 4 for one dish: name, price and the quick-note chips they can tap. */
function AddStep({ dish }: { dish: DishDto }) {
  return (
    <div className="grid min-w-0 gap-2.5 rounded-card border border-line bg-card p-3">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <b className="min-w-0 break-words text-[15.5px] font-semibold [overflow-wrap:anywhere]">{dish.name}</b>
        <span className="text-sm tabular-nums text-fg-2">{formatCurrency(dish.price)}</span>
      </div>
      <p className="text-xs font-medium text-muted-fg">Notas rápidas</p>
      {dish.quickNotes.length === 0 ? (
        <p className="text-sm text-muted-fg">Sin notas rápidas: el mesero solo escribe la nota para cocina.</p>
      ) : (
        <ul aria-label={`Notas rápidas de ${dish.name}`} className="flex min-w-0 flex-wrap gap-1.5">
          {dish.quickNotes.map((note) => (
            <li
              key={note}
              className="inline-flex min-h-9 min-w-0 max-w-full items-center rounded-pill border border-line bg-surface px-3 text-[13px] break-words [overflow-wrap:anywhere]"
            >
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * "Así lo ve el mesero": the waiter's step 1 (categories), step 2
 * (subcategories, or the dishes straight away for a category without them),
 * step 3 (the dishes of a subcategory) and step 4 (a dish with its quick
 * notes), from the draft the next publication serves (T27).
 */
export function WaiterPreview({
  nodes,
  selected,
  unpublished = false,
}: {
  nodes: AdminCategoryNode[]
  selected: AdminCategoryNode | null
  /** "n cambios sin publicar": the waiters still see the previous publication. */
  unpublished?: boolean
}) {
  const titleId = useId()
  const [step, setStep] = useState<1 | 2>(1)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)
  const [dishId, setDishId] = useState<string | null>(null)
  const active = nodes.filter((node) => node.category.active)
  const shown = step === 2 && selected ? selected : null
  const view = shown ? waiterView(shown) : null
  const subcategory = view?.subcategories.find((s) => s.subcategory.id === subcategoryId) ?? null
  const dish = view ? ([...view.dishes, ...view.subcategories.flatMap((s) => s.dishes)].find((d) => d.id === dishId) ?? null) : null
  const selectedKey = selected?.category.id

  // Another category starts its own steps 3 and 4 over.
  useEffect(() => {
    setSubcategoryId(null)
    setDishId(null)
  }, [selectedKey])

  const goTo = (value: 1 | 2) => {
    setStep(value)
    setSubcategoryId(null)
    setDishId(null)
  }

  const crumbs = !shown
    ? ["1 Categoría › 2 Subcategoría › 3 Plato › 4 Agregar"]
    : [
        shown.category.name,
        ...(shown.skipsSubcategoryStep ? [] : [subcategory ? subcategory.subcategory.name : "2 Subcategoría"]),
        ...(dish ? [dish.name, "4 Agregar"] : subcategory || shown.skipsSubcategoryStep ? ["3 Plato"] : []),
      ]
  const dishTiles = (dishes: DishDto[], node: AdminCategoryNode) =>
    dishes.map((d) => (
      <Tile key={d.id} node={node} title={d.name} detail={formatCurrency(d.price)} icon={false} onOpen={() => setDishId(d.id)} />
    ))
  const shownCount = dish
    ? 1
    : shown
      ? subcategory
        ? subcategory.dishes.length
        : shown.skipsSubcategoryStep
          ? (view?.dishes.length ?? 0)
          : (view?.subcategories.length ?? 0)
      : active.length

  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={titleId} className="text-base font-semibold">
          Así lo ve el mesero
        </h2>
        {unpublished && (
          <span className="inline-flex min-h-6 items-center rounded-pill border border-status-warning-line bg-status-warning-bg px-2 text-xs font-medium text-status-warning-fg">
            Vista previa (sin publicar)
          </span>
        )}
      </div>
      <p className="text-sm text-muted-fg">
        {unpublished
          ? "Así quedará al publicar, con los mismos colores, íconos y orden."
          : "Igual a lo que ven los meseros, con los mismos colores, íconos y orden."}
      </p>
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
              onClick={() => goTo(option.value)}
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
        <p className="flex min-w-0 flex-wrap gap-1.5 text-[12.5px] text-fg-2">
          {crumbs.map((crumb, index) => (
            <span key={`${index}-${crumb}`} className="flex min-w-0 gap-1.5 break-words [overflow-wrap:anywhere]">
              {index > 0 && (
                <span aria-hidden className="text-muted-fg">
                  ›
                </span>
              )}
              <span className="min-w-0">{crumb}</span>
            </span>
          ))}
        </p>
        {dish ? (
          <AddStep dish={dish} />
        ) : shown && view ? (
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
            {subcategory
              ? dishTiles(subcategory.dishes, shown)
              : shown.skipsSubcategoryStep
                ? dishTiles(view.dishes, shown)
                : view.subcategories.map((s) => (
                    <Tile
                      key={s.subcategory.id}
                      node={shown}
                      title={s.subcategory.name}
                      detail={plural(s.dishes.length, "plato", "platos")}
                      onOpen={() => setSubcategoryId(s.subcategory.id)}
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
        {shownCount === 0 && <p className="text-sm text-muted-fg">Nada que mostrar todavía en este paso.</p>}
      </div>
    </section>
  )
}
