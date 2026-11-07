"use client"

import { Search, X } from "lucide-react"
import { focusRing } from "@/components/cashier/cashier-ui"
import { cn } from "@/lib/utils"
import {
  ACTIVE_STATUS_INFO,
  ACTIVE_STATUS_ORDER,
  type RowFilters,
  type StatusFilter,
  type TypeFilter,
} from "@/lib/admin/orders"

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "Mesas y domicilios" },
  { value: "table", label: "Solo mesas" },
  { value: "delivery", label: "Solo domicilios" },
]

interface OrdersToolbarProps {
  filters: RowFilters
  onChange: (filters: RowFilters) => void
  counts: Record<StatusFilter, number>
}

/** Search, status chips with counts (the real order statuses) and the order type. */
export function OrdersToolbar({ filters, onChange, counts }: OrdersToolbarProps) {
  const chips: Array<{ value: StatusFilter; label: string }> = [
    { value: "all", label: "Todos" },
    ...ACTIVE_STATUS_ORDER.map((status) => ({ value: status as StatusFilter, label: ACTIVE_STATUS_INFO[status].label })),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
      <div role="search" className="relative min-w-0 lg:w-80 lg:flex-none">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" />
        <label htmlFor="orders-search" className="sr-only">
          Buscar órdenes
        </label>
        <input
          id="orders-search"
          type="search"
          autoComplete="off"
          placeholder="#128, mesa, mesero o cliente"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          className={cn(
            "h-11 w-full rounded-pill border border-line bg-surface-2 pl-10 pr-11 text-sm text-fg placeholder:text-muted-fg [&::-webkit-search-cancel-button]:hidden",
            focusRing,
          )}
        />
        {filters.query && (
          <button
            type="button"
            aria-label="Limpiar búsqueda"
            onClick={() => onChange({ ...filters, query: "" })}
            className={cn(
              "absolute right-0.5 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-fg hover:text-fg",
              focusRing,
            )}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Phone/tablet: the chips scroll sideways with an edge fade; they never wrap or clip. */}
      <div className="relative min-w-0 lg:min-w-[29rem] lg:flex-1">
        <div
          role="group"
          aria-label="Filtrar por estado"
          className="flex gap-2 overflow-x-auto py-0.5 pr-6 [-ms-overflow-style:none] [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {chips.map(({ value, label }) => {
            const pressed = filters.status === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={pressed}
                onClick={() => onChange({ ...filters, status: value })}
                className={cn(
                  "inline-flex min-h-[44px] flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border px-3.5 text-sm font-medium",
                  focusRing,
                  pressed
                    ? "border-brand-line bg-brand-tint text-brand-strong"
                    : "border-line bg-surface text-fg-2 hover:text-fg",
                )}
              >
                {label}
                <span className="tabular-nums text-xs text-muted-fg">{counts[value]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <label htmlFor="orders-type" className="sr-only">
        Tipo de orden
      </label>
      <select
        id="orders-type"
        value={filters.type}
        onChange={(event) => onChange({ ...filters, type: event.target.value as TypeFilter })}
        className={cn(
          "h-11 w-full rounded-pill border border-line bg-surface px-4 text-sm font-medium text-fg sm:w-auto lg:flex-none",
          focusRing,
        )}
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
