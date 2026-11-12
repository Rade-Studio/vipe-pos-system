"use client"

import type React from "react"
import { Search, ShoppingBag } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/helpers"
import { cn } from "@/lib/utils"
import { entryMeta, type QueueEntry } from "@/lib/cashier/queue"
import { Chip, Eyebrow, Money, focusRing, toneClasses } from "./cashier-ui"

export type QueueTab = "tables" | "takeaway" | "deliveries" | "partials" | "paid"

interface CashierQueueProps {
  tab: QueueTab
  onTabChange: (tab: QueueTab) => void
  /** Pending counts; "Pagadas" shows none (it is history, not work). */
  counts: Record<Exclude<QueueTab, "paid">, number>
  query: string
  onQueryChange: (query: string) => void
  entries: QueueEntry[]
  /** Rows before the search filter, to tell "empty" from "no match". */
  unfilteredCount: number
  selectedKey: string | null
  onSelect: (entry: QueueEntry) => void
  loading: boolean
  /** The Domicilios tab body (the delivery panel keeps its own payment flow). */
  deliveries: React.ReactNode
  /** The Pagadas tab body (T24). */
  paid: React.ReactNode
  /** S8: "Para llevar" starts a takeaway order; absent = no button. */
  onNewTakeaway?: () => void
}

const TABS: Array<{ id: QueueTab; label: string }> = [
  { id: "tables", label: "Mesas" },
  { id: "takeaway", label: "Para llevar" },
  { id: "deliveries", label: "Domicilios" },
  { id: "partials", label: "Parciales" },
  { id: "paid", label: "Pagadas" },
]

/** Left pane: what is waiting to be charged, by type, with a search. */
export function CashierQueue({
  tab,
  onTabChange,
  counts,
  query,
  onQueryChange,
  entries,
  unfilteredCount,
  selectedKey,
  onSelect,
  loading,
  deliveries,
  paid,
  onNewTakeaway,
}: CashierQueueProps) {
  return (
    <div className="flex min-h-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Eyebrow>Por cobrar</Eyebrow>
          <h2 className="text-lg font-bold text-fg">Órdenes para facturar</h2>
        </div>
        {onNewTakeaway && (
          <button
            type="button"
            onClick={onNewTakeaway}
            className={cn(
              "inline-flex min-h-[44px] flex-none items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-fg hover:bg-surface-2",
              focusRing,
            )}
          >
            <ShoppingBag aria-hidden="true" className="h-4 w-4" />
            Nuevo para llevar
          </button>
        )}
      </div>

      <div
        className="grid grid-cols-3 gap-1 rounded-md bg-surface-2 p-1 md:grid-cols-5 min-[1180px]:grid-cols-3"
        role="tablist"
        aria-label="Tipo de orden"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            className={cn(
              "inline-flex min-h-[44px] min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-sm font-semibold",
              focusRing,
              tab === id ? "bg-surface text-fg shadow-sm" : "text-muted-fg hover:text-fg",
            )}
          >
            {label}
            {id !== "paid" && (
              <span
                className={cn(
                  "rounded-pill px-1.5 text-xs tabular-nums",
                  tab === id ? "bg-brand-tint text-brand" : "bg-surface text-muted-fg",
                )}
              >
                {counts[id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {(tab === "tables" || tab === "takeaway" || tab === "partials") && (
        <label className="flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 focus-within:ring-2 focus-within:ring-focus">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-fg" />
          <span className="sr-only">Buscar orden</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={tab === "takeaway" ? "Cliente, mesero o # de orden" : "Mesa, mesero o # de orden"}
            className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted-fg"
          />
        </label>
      )}

      {tab === "paid" ? (
        <div className="min-h-0">{paid}</div>
      ) : tab === "deliveries" ? (
        <div className="min-h-0">
          {deliveries}
          {counts.deliveries === 0 && <p className="text-sm text-muted-fg">No hay domicilios por cobrar.</p>}
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">Cargando órdenes por cobrar…</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-card motion-reduce:animate-none" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        unfilteredCount === 0 ? (
          <div className="rounded-card border border-dashed border-line p-4 text-center">
            <h3 className="font-semibold text-fg">Nada por cobrar</h3>
            <p className="mt-1 text-sm text-muted-fg">
              Cuando un mesero envíe una orden o se divida una cuenta, aparecerá aquí.
            </p>
          </div>
        ) : (
          <p className="p-2 text-sm text-muted-fg">Ninguna orden coincide con la búsqueda</p>
        )
      ) : (
        <ul className="flex min-h-0 flex-col gap-2 md:max-[1179px]:flex-row md:max-[1179px]:overflow-x-auto md:max-[1179px]:pb-1">
          {entries.map((entry) => {
            const selected = entry.key === selectedKey
            return (
              <li key={entry.key} className="md:max-[1179px]:w-80 md:max-[1179px]:shrink-0">
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(entry)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 rounded-card border p-3 text-left transition-colors motion-reduce:transition-none",
                    focusRing,
                    selected ? "border-brand bg-brand-tint" : "border-line bg-surface hover:bg-surface-2",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-base font-bold tabular-nums",
                      toneClasses(entry.status.tone),
                    )}
                  >
                    {entry.kind === "takeaway" ? <ShoppingBag className="h-5 w-5" /> : (entry.tableNumber ?? "?")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-fg">{entry.label}</span>{" "}
                    <span className="block truncate text-xs text-muted-fg" title={entryMeta(entry)}>
                      {entryMeta(entry)}
                    </span>
                  </span>{" "}
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Money className="text-sm font-bold text-fg">{formatCurrency(entry.total)}</Money>{" "}
                    <Chip tone={entry.status.tone}>{entry.status.label}</Chip>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
