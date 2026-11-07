import { useState } from "react"
import { ChevronDown, Search } from "lucide-react"
import type { DishRouteDto, StationDto, StationRoutesDto } from "@/lib/api/stations"
import { searchRoutes } from "@/lib/admin/stations"
import { cn } from "@/lib/utils"
import { platos, SELECT_CLASS } from "./station-style"

/** Dishes shown per open category before "Ver los N platos restantes". */
const FIRST_DISHES = 3

interface CategoryRoutesProps {
  routes: StationRoutesDto
  prep: StationDto[]
  fallbackName: string
  busy: boolean
  onCategory: (categoryId: string, stationId: string | null) => void
  onDish: (dish: DishRouteDto, stationId: string | null) => void
}

export const categorySelectId = (categoryId: string) => `station-of-category-${categoryId}`

/**
 * "Rutas por categoría": the default station of every category, and inside a
 * category its dishes, where choosing another station makes an exception and
 * choosing the category's station clears it. The search finds categories and
 * dishes; a dish hit opens its category.
 */
export function CategoryRoutes({ routes, prep, fallbackName, busy, onCategory, onDish }: CategoryRoutesProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const rows = searchRoutes(routes, query)
  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  return (
    <section aria-labelledby="routes-h" className="min-w-0 rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 px-4 pb-2 pt-4 sm:px-5">
        <h2 id="routes-h" className="flex-1 font-semibold">
          Rutas por categoría
        </h2>
        <label className="flex min-h-11 w-full items-center gap-2 rounded-full border border-line-strong bg-card px-3.5 text-muted-fg sm:w-72">
          <Search className="h-4 w-4 flex-none" aria-hidden />
          <span className="sr-only">Buscar plato o categoría</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar plato o categoría"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted-fg"
          />
        </label>
      </div>
      <div className="px-2 pb-2.5">
        {rows.length === 0 && <p className="px-3 py-4 text-sm text-muted-fg">Ningún plato ni categoría coincide con la búsqueda.</p>}
        {rows.map(({ category, dishes, matched }) => {
          const unrouted = category.stationId === null
          const expanded = matched || open.has(category.id)
          const visible = showAll.has(category.id) || matched ? dishes : dishes.slice(0, FIRST_DISHES)
          return (
            <div key={category.id} className="border-t border-line first:border-t-0">
              <div
                className={cn(
                  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-2.5 py-2.5 md:grid-cols-[minmax(0,1fr)_230px_auto] md:min-h-[60px] md:py-1.5",
                  unrouted && "rounded-xl bg-status-warning-bg text-status-warning-fg",
                )}
              >
                <span className="min-w-0">
                  <b className="block font-semibold">{category.name}</b>
                  <small className={cn("text-[12.5px]", unrouted ? "text-status-warning-fg" : "text-muted-fg")}>{platos(category.dishCount)}</small>
                </span>
                <select
                  id={categorySelectId(category.id)}
                  aria-label={`Estación de ${category.name}`}
                  value={category.stationId ?? ""}
                  disabled={busy}
                  onChange={(event) => onCategory(category.id, event.target.value || null)}
                  className={cn(SELECT_CLASS, "col-span-2 md:col-span-1", unrouted && "border-status-warning-line bg-status-warning-bg text-status-warning-fg")}
                >
                  {unrouted && <option value="">Sin estación (va a {fallbackName})</option>}
                  {prep.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
                <span className="col-start-2 row-start-1 flex justify-end md:col-start-3">
                  {dishes.length > 0 && !matched && (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`dishes-${category.id}`}
                      aria-label={`Ver platos de ${category.name}`}
                      onClick={() => setOpen((set) => toggle(set, category.id))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-surface-2 focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
                      Ver platos
                    </button>
                  )}
                </span>
              </div>
              {expanded && (
                <ul
                  id={`dishes-${category.id}`}
                  aria-label={`Platos de ${category.name}`}
                  className="mb-2 ml-2 rounded-r-xl border-l-2 border-brand-line bg-surface-2 px-3 py-1 md:ml-6 md:mr-2.5"
                >
                  {visible.map((dish) => {
                    const exception = dish.stationId !== null
                    return (
                      <li key={dish.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line py-2 first:border-t-0 md:min-h-14 md:flex-nowrap md:py-1">
                        <b className={cn("min-w-0 flex-1 font-semibold", !dish.active && "text-muted-fg")}>
                          {dish.name}
                          {!dish.active && <span className="font-normal"> · inactivo</span>}
                        </b>
                        {exception ? (
                          <span className="inline-flex h-[26px] items-center rounded-full border border-status-occupied-line bg-status-occupied-bg px-2.5 text-[12.5px] font-semibold text-status-occupied-fg">
                            Excepción
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-muted-fg">Igual que la categoría</span>
                        )}
                        <select
                          aria-label={`Estación de ${dish.name}`}
                          value={dish.stationId ?? category.stationId ?? ""}
                          disabled={busy}
                          onChange={(event) => onDish(dish, event.target.value === (category.stationId ?? "") ? null : event.target.value)}
                          className={cn(SELECT_CLASS, "md:w-44")}
                        >
                          {!dish.stationId && !category.stationId && <option value="">Sin estación (va a {fallbackName})</option>}
                          {prep.map((station) => (
                            <option key={station.id} value={station.id}>
                              {station.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    )
                  })}
                  {visible.length < dishes.length && (
                    <li className="border-t border-line py-1">
                      <button
                        type="button"
                        onClick={() => setShowAll((set) => toggle(set, category.id))}
                        className="min-h-11 rounded-full px-3 text-[13px] font-medium hover:bg-surface focus-visible:outline-dashed focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        Ver los {dishes.length - visible.length} platos restantes
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
