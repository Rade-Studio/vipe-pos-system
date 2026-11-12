"use client"

import { useId, useMemo, useState } from "react"
import { X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * promociones T6 (S10) — the "+ Agregar" chips of the editor: what a
 * promotion reaches (products, categories, subcategories) or the dishes of a
 * combo group, picked from a search over the menu the admin already caches.
 */

export interface PickOption {
  key: string
  name: string
  /** "Categoría", "Subcategoría", "Plato". */
  kind: string
  /** "3 platos", "$29.000". */
  detail: string
}

const SHOWN = 8
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es")

interface ItemPickerProps {
  label: string
  options: readonly PickOption[]
  picked: readonly string[]
  onAdd: (key: string) => void
  onRemove: (key: string) => void
  /** Shown inside the box while nothing is picked. */
  placeholder?: string
  error?: string
  errorId?: string
}

export function ItemPicker({ label, options, picked, onAdd, onRemove, placeholder, error, errorId }: ItemPickerProps) {
  const labelId = useId()
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options])
  const results = useMemo(() => {
    const needle = fold(query.trim())
    return options.filter((o) => !picked.includes(o.key) && (!needle || fold(o.name).includes(needle))).slice(0, SHOWN)
  }, [options, picked, query])

  const add = (key: string) => {
    onAdd(key)
    setQuery("")
    setSearching(false)
  }

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={error ? errorId : undefined} className="grid gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border bg-background p-2",
          error && "border-destructive",
        )}
      >
        {picked.length === 0 && !searching && placeholder && <span className="px-1 text-sm text-muted-foreground">{placeholder}</span>}
        {picked.map((key) => {
          const option = byKey.get(key)
          const name = option?.name ?? "Elemento eliminado"
          return (
            <span key={key} className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card pl-3 pr-1 text-sm">
              {option && option.kind !== "Plato" && <span className="text-xs text-muted-foreground">{option.kind}</span>}
              <span>
                {name}
                {option && option.kind !== "Plato" ? ` · ${option.detail}` : ""}
              </span>
              <button
                type="button"
                aria-label={`Quitar ${name}`}
                onClick={() => onRemove(key)}
                className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          )
        })}
        {!searching && (
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="h-8 rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + Agregar
          </button>
        )}
      </div>
      {searching && (
        <div className="grid gap-1.5 rounded-md border bg-card p-2">
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                setSearching(false)
              }
              if (e.key === "Enter") {
                e.preventDefault()
                if (results[0]) add(results[0].key)
              }
            }}
            placeholder="Buscar por nombre"
            aria-label={`Buscar en ${label}`}
            className="h-11"
          />
          {results.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Sin resultados</p>
          ) : (
            <ul className="grid gap-1">
              {results.map((option) => (
                <li key={option.key}>
                  <button
                    type="button"
                    onClick={() => add(option.key)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">{option.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.kind} · {option.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setSearching(false)}
            className="h-9 justify-self-end rounded-md px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cerrar búsqueda
          </button>
        </div>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
