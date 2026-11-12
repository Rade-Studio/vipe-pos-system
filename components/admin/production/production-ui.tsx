"use client"

import { Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { itemStockStatus } from "@/components/admin/stock/stock-ui"
import type { InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"

/** Status of a preparation on this page: "over" counts as OK. */
export type PrepStatus = "out" | "low" | "ok"
export type StatusFilter = "all" | PrepStatus

export const prepStatus = (item: InventoryItem): PrepStatus => {
  const status = itemStockStatus(item)
  return status === "out" || status === "low" ? status : "ok"
}

const RANK: Record<PrepStatus, number> = { out: 0, low: 1, ok: 2 }
const LABEL: Record<PrepStatus, string> = { out: "Agotada", low: "Baja", ok: "OK" }
const VARIANT = { out: "destructive", low: "warning", ok: "outline" } as const

/** Agotadas, then Bajas, then OK; by name within each. */
export const sortPreps = (preps: readonly InventoryItem[]) =>
  [...preps].sort((a, b) => RANK[prepStatus(a)] - RANK[prepStatus(b)] || a.name.localeCompare(b.name, "es"))

export const matchesPrep = (item: InventoryItem, query: string, status: StatusFilter) => {
  const text = query.trim().toLowerCase()
  return (status === "all" || prepStatus(item) === status) && (!text || `${item.name} ${item.sku}`.toLowerCase().includes(text))
}

export function PrepStatusBadge({ item }: { item: InventoryItem }) {
  const status = prepStatus(item)
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}

const CHIPS: { value: StatusFilter; label: string; dot?: string }[] = [
  { value: "all", label: "Todas" },
  { value: "out", label: "Agotadas", dot: "bg-destructive" },
  { value: "low", label: "Bajas", dot: "bg-yellow-500" },
  { value: "ok", label: "OK", dot: "bg-emerald-500" },
]

interface PrepFiltersProps {
  preps: readonly InventoryItem[]
  query: string
  status: StatusFilter
  onQuery: (query: string) => void
  onStatus: (status: StatusFilter) => void
  label: string
  children?: React.ReactNode
}

/** Search by name or code plus the status chips with counts. */
export function PrepFilters({ preps, query, status, onQuery, onStatus, label, children }: PrepFiltersProps) {
  const counts = { all: preps.length, out: 0, low: 0, ok: 0 }
  for (const prep of preps) counts[prepStatus(prep)]++
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchField label="Buscar preparación" placeholder="Buscar por nombre o código…" value={query} onChange={onQuery} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            aria-pressed={status === chip.value}
            onClick={() => onStatus(chip.value)}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              status === chip.value && "border-primary/50 bg-primary/10 text-foreground",
            )}
          >
            {chip.dot && <span aria-hidden className={cn("h-2 w-2 rounded-full", chip.dot)} />}
            {chip.label} <span className="tabular-nums">{counts[chip.value]}</span>
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 pl-9"
      />
    </div>
  )
}

/** "1,5" for 1.5: the text a quantity field shows. */
export const quantityText = (value: number) => String(Math.round(value * 10_000) / 10_000).replace(".", ",")

/** Saves `text` (already with its BOM) as a CSV download. */
export function downloadCsv(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
