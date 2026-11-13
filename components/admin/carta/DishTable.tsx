"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { CartaAdminCategory, CartaAdminDish } from "@/lib/api/carta-admin"
import { cn } from "@/lib/utils"

export const PAGE_SIZE = 25

/** Lower case without accents, so "lena" finds "leña". */
export const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

export interface DishStatus<K extends string> {
  key: K
  label: string
  match: (dish: CartaAdminDish) => boolean
}

/** Search + status chip + category + "Mostrar más" state shared by the dish tables. */
export function useDishFilter<K extends string>(dishes: CartaAdminDish[], statuses: DishStatus<K>[]) {
  const [query, setQueryState] = useState("")
  const [status, setStatusState] = useState<K>(statuses[0].key)
  const [category, setCategoryState] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)

  const searched = useMemo(() => {
    const q = fold(query.trim())
    return dishes.filter(
      (dish) =>
        (!category || dish.categoryId === category) &&
        (!q || fold(dish.name).includes(q) || fold(dish.description ?? "").includes(q)),
    )
  }, [dishes, query, category])

  const counts = Object.fromEntries(statuses.map((s) => [s.key, searched.filter(s.match).length])) as Record<K, number>
  const active = statuses.find((s) => s.key === status) ?? statuses[0]
  const filtered = searched.filter(active.match)
  const reset = () => setLimit(PAGE_SIZE)

  return {
    query,
    setQuery: (v: string) => {
      setQueryState(v)
      reset()
    },
    status,
    setStatus: (v: K) => {
      setStatusState(v)
      reset()
    },
    category,
    setCategory: (v: string) => {
      setCategoryState(v)
      reset()
    },
    counts,
    filtered,
    visible: filtered.slice(0, limit),
    hidden: Math.max(0, filtered.length - limit),
    showMore: () => setLimit((n) => n + PAGE_SIZE),
  }
}

export type DishFilter<K extends string> = ReturnType<typeof useDishFilter<K>>

/** Search box, status chips with counts, category select and the bulk save. */
export function DishTableToolbar<K extends string>({
  filter,
  statuses,
  categories,
  dirtyCount,
  saving,
  onSaveAll,
  children,
}: {
  filter: DishFilter<K>
  statuses: DishStatus<K>[]
  categories?: CartaAdminCategory[]
  dirtyCount: number
  saving: boolean
  onSaveAll: () => void
  children?: ReactNode
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b bg-card px-4 pb-3 pt-1 sm:-mx-6 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Buscar plato"
            placeholder="Buscar plato"
            value={filter.query}
            onChange={(e) => filter.setQuery(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
        {categories && categories.length > 0 && (
          <select
            aria-label="Categoría"
            value={filter.category}
            onChange={(e) => filter.setCategory(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <Button type="button" size="sm" className="h-10 sm:ml-auto" disabled={dirtyCount === 0 || saving} onClick={onSaveAll}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios ({dirtyCount})
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar platos">
        {statuses.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={filter.status === s.key}
            onClick={() => filter.setStatus(s.key)}
            className={cn(
              "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter.status === s.key && "border-primary/50 bg-primary/10 text-foreground",
            )}
          >
            {`${s.label} (${filter.counts[s.key]})`}
          </button>
        ))}
        {children}
      </div>
    </div>
  )
}

/** Empty states and the "Mostrar más" button under a dish table. */
export function DishTableFooter({ total, filter }: { total: number; filter: { filtered: unknown[]; hidden: number; showMore: () => void } }) {
  if (total === 0) return <p className="py-4 text-sm text-muted-foreground">Aún no hay platos en el menú.</p>
  if (filter.filtered.length === 0) return <p className="py-4 text-sm text-muted-foreground">Ningún plato coincide con la búsqueda.</p>
  if (filter.hidden === 0) return null
  return (
    <div className="flex justify-center">
      <Button type="button" variant="outline" size="sm" onClick={filter.showMore}>
        Mostrar más ({filter.hidden})
      </Button>
    </div>
  )
}

/** Saves the given dishes one after the other. */
export async function saveEach(ids: string[], onSave: (id: string) => Promise<void>) {
  for (const id of ids) await onSave(id)
}
