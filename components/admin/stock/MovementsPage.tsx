"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { formatMoney } from "@/components/admin/inventory-shared"
import { downloadCsv } from "@/components/admin/production/production-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useInventoryItems, useInventoryLocations, useInventoryMovements } from "@/hooks/inventory"
import { isAdminSectionId } from "@/lib/admin/navigation"
import type { Movement, MovementFilters, MovementType } from "@/lib/api/inventory/types"
import {
  documentSection,
  documentText,
  groupMovementsByDay,
  groupOfType,
  MOVEMENT_GROUPS,
  MOVEMENT_LABEL,
  movementsCsv,
  type MovementGroupId,
} from "@/lib/inventory/movements"
import { clockOf } from "@/lib/inventory/production-csv"
import { addDaysIso, dayLabel, localIsoDate } from "@/lib/inventory/production-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import { cn } from "@/lib/utils"
import { NativeSelect, signedClass } from "./stock-ui"

const PAGE_SIZE = 50

export interface MovementFilterState {
  itemId: string
  locationId: string
  types: MovementType[]
  from: string
  to: string
  page: number
}

/** Hook arguments for the current filter: blank fields are omitted. */
export function buildMovementFilters(state: MovementFilterState, pageSize = PAGE_SIZE): MovementFilters {
  return {
    ...(state.itemId ? { itemId: state.itemId } : {}),
    ...(state.locationId ? { locationId: state.locationId } : {}),
    ...(state.types.length ? { types: state.types } : {}),
    ...(state.from ? { from: state.from } : {}),
    ...(state.to ? { to: state.to } : {}),
    page: state.page,
    pageSize,
  }
}

/** Server-side pager for the movements ledger. */
export function MovementPager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        Página {page} de {pageCount} · {total} movimientos
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Página siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

const EMPTY: MovementFilterState = { itemId: "", locationId: "", types: [], from: "", to: "", page: 1 }

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const GROUP_DOT: Record<MovementGroupId, string> = {
  sale: "bg-sky-500",
  purchase: "bg-emerald-500",
  production: "bg-orange-500",
  adjustment: "bg-yellow-500",
  waste: "bg-destructive",
  transfer: "bg-violet-500",
}

/** "+$ 1.000" / "−$ 1.000". */
const signedMoney = (value: number) => `${value < 0 ? "−" : "+"}${formatMoney(Math.abs(value))}`

function TypeChip({ type }: { type: MovementType }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium">
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", GROUP_DOT[groupOfType(type)])} />
      {MOVEMENT_LABEL[type]}
    </span>
  )
}

function Origin({ movement, onNavigate }: { movement: Movement; onNavigate?: (sectionId: string) => void }) {
  const text = documentText(movement)
  if (!text) return <span className="text-muted-foreground">Manual</span>
  const section = documentSection(movement.documentKind)
  if (!onNavigate || !section || !isAdminSectionId(section)) return <span>{text}</span>
  return (
    <button
      type="button"
      aria-label={`Abrir ${movement.documentLabel}`}
      onClick={() => onNavigate(section)}
      className="inline-flex items-center gap-0.5 text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {text}
      <ChevronRight aria-hidden className="h-3 w-3" />
    </button>
  )
}

const COLUMNS = ["Hora", "Artículo", "Tipo", "Bodega", "Cantidad", "Valor", "Origen", "Motivo · quién"]
const cellClass = "block md:table-cell md:px-3 md:py-1.5"

/** S4: range totals on one line, rows by day, type chips and the link to each source document. */
export function MovementsPage({ description, onNavigate }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const [state, setState] = useState<MovementFilterState>(EMPTY)
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const filters = buildMovementFilters(state)
  const movements = useInventoryMovements(filters)
  const rows = useMemo(() => movements.data?.rows ?? [], [movements.data])
  const days = groupMovementsByDay(rows)
  const totals = movements.data?.totals ?? { count: 0, inValue: 0, outValue: 0 }
  const today = localIsoDate(new Date())
  const yesterday = addDaysIso(today, -1)

  const update = (patch: Partial<MovementFilterState>) => setState((s) => ({ ...s, page: 1, ...patch }))
  const group = MOVEMENT_GROUPS.find((g) => g.types.join() === state.types.join())?.id ?? null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Movimientos"
        description={description}
        actions={
          <Button variant="outline" className="min-h-11" onClick={() => downloadCsv("movimientos.csv", movementsCsv(rows))} disabled={rows.length === 0}>
            <Download aria-hidden className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <NativeSelect aria-label="Artículo" className="h-11" value={state.itemId} onChange={(e) => update({ itemId: e.target.value })}>
            <option value="">Todos los artículos</option>
            {(items.data ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.sku} · {i.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Bodega" className="h-11" value={state.locationId} onChange={(e) => update({ locationId: e.target.value })}>
            <option value="">Todas las bodegas</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" className="h-11" aria-label="Desde" value={state.from} onChange={(e) => update({ from: e.target.value })} />
          <Input type="date" className="h-11" aria-label="Hasta" value={state.to} onChange={(e) => update({ to: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de movimiento">
          <button type="button" aria-pressed={state.types.length === 0} onClick={() => update({ types: [] })} className={cn(CHIP, state.types.length === 0 && "border-primary/50 bg-primary/10 text-foreground")}>
            Todos
          </button>
          {MOVEMENT_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={group === g.id}
              onClick={() => update({ types: g.types })}
              className={cn(CHIP, group === g.id && "border-primary/50 bg-primary/10 text-foreground")}
            >
              <span aria-hidden className={cn("h-2 w-2 rounded-full", GROUP_DOT[g.id])} />
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div role="status" aria-label="Totales del rango" className="flex flex-wrap gap-x-1 gap-y-1 border-b px-3 py-2.5 text-sm text-muted-foreground">
          <span>
            <b className="tabular-nums text-foreground">{totals.count}</b> movimientos
          </span>
          <span aria-hidden>{" · "}</span>
          <span>
            Entradas <b className="tabular-nums text-emerald-600 dark:text-emerald-400">+{formatMoney(totals.inValue)}</b>
          </span>
          <span aria-hidden>{" · "}</span>
          <span>
            Salidas <b className="tabular-nums text-destructive">−{formatMoney(totals.outValue)}</b>
          </span>
          <span aria-hidden>{" · "}</span>
          <span>
            Neto <b className="tabular-nums text-foreground">{signedMoney(totals.inValue - totals.outValue)}</b>
          </span>
        </div>
        <table className="block w-full text-sm md:table" aria-label="Movimientos agrupados por día, más recientes primero">
          <thead className="hidden md:table-header-group">
            <tr className="text-xs text-muted-foreground">
              {COLUMNS.map((label, i) => (
                <th key={label} scope="col" className={cn("h-10 border-b px-3 text-left font-medium", (i === 4 || i === 5) && "text-right")}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {movements.isLoading ? (
            <tbody className="block md:table-row-group">
              <tr className="block md:table-row">
                <td colSpan={COLUMNS.length} className="block p-3 md:table-cell">
                  <Skeleton className="h-24" />
                </td>
              </tr>
            </tbody>
          ) : days.length === 0 ? (
            <tbody className="block md:table-row-group">
              <tr className="block md:table-row">
                <td colSpan={COLUMNS.length} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                  No hay movimientos con estos filtros. Prueba con otro periodo o tipo.
                </td>
              </tr>
            </tbody>
          ) : (
            days.map((day) => (
              <tbody key={day.day} className="block md:table-row-group">
                <tr className="block bg-muted/50 md:table-row">
                  <th colSpan={COLUMNS.length} scope="rowgroup" className="block px-3 py-2 text-left text-sm font-semibold md:table-cell">
                    {day.day === today ? "Hoy · " : day.day === yesterday ? "Ayer · " : ""}
                    {dayLabel(day.day)}
                    <span className="float-right font-normal text-muted-foreground">
                      {day.rows.length} {day.rows.length === 1 ? "movimiento" : "movimientos"} · neto{" "}
                      <span className="tabular-nums">{signedMoney(day.net)}</span>
                    </span>
                  </th>
                </tr>
                {day.rows.map((m) => (
                  <tr key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b px-3 py-2.5 md:table-row md:p-0">
                    <td className={cn(cellClass, "order-6 text-xs tabular-nums text-muted-foreground md:text-sm")}>{clockOf(m.createdAt)}</td>
                    <td className={cn(cellClass, "order-1 min-w-0")}>
                      <span className="font-medium">{m.itemName ?? "—"}</span> <span className="font-mono text-xs text-muted-foreground">{m.sku}</span>
                    </td>
                    <td className={cn(cellClass, "order-3")}>
                      <TypeChip type={m.movementType} />
                    </td>
                    <td className={cn(cellClass, "order-4 justify-self-end text-xs text-muted-foreground md:text-sm md:text-foreground")}>{m.locationName ?? "—"}</td>
                    <td className={cn(cellClass, "order-2 justify-self-end font-semibold tabular-nums md:text-right md:font-normal")}>
                      <span className={signedClass(m.quantity)}>
                        {m.quantity < 0 ? "−" : "+"}
                        {formatQuantity(Math.abs(m.quantity), m.unit ?? "")}
                      </span>
                    </td>
                    <td className={cn(cellClass, "order-5 justify-self-end tabular-nums md:text-right")}>{signedMoney(m.totalCost)}</td>
                    <td className={cn(cellClass, "order-7")}>
                      <Origin movement={m} onNavigate={onNavigate} />
                    </td>
                    <td className={cn(cellClass, "order-8 col-span-2 text-xs text-muted-foreground md:text-sm")}>
                      {[m.reason, m.createdByName].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))
          )}
        </table>
      </div>
      <MovementPager page={state.page} pageSize={PAGE_SIZE} total={movements.data?.total ?? 0} onPage={(page) => setState((s) => ({ ...s, page }))} />
    </div>
  )
}
