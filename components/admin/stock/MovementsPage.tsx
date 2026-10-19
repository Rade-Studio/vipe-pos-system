"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { StatCard } from "@/components/admin/common/StatCard"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useInventoryItems, useInventoryLocations, useInventoryMovements } from "@/hooks/inventory"
import { formatQuantity } from "@/lib/inventory/units"
import type { Movement, MovementFilters, MovementType } from "@/lib/supabase/inventory/types"
import { formatCurrency } from "@/utils/helpers"
import { MOVEMENT_LABEL, MOVEMENT_TYPES, NativeSelect, signedClass } from "./stock-ui"

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

const csvCell = (value: string | number | null) => {
  const text = value === null ? "" : String(value)
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function movementsCsv(rows: Movement[]): string {
  const header = ["Fecha", "SKU", "Artículo", "Bodega", "Tipo", "Cantidad", "Unidad", "Costo unitario", "Costo total", "Motivo"]
  const lines = rows.map((m) =>
    [m.createdAt, m.sku, m.itemName, m.locationName, MOVEMENT_LABEL[m.movementType], m.quantity, m.unit, m.unitCost, m.totalCost, m.reason]
      .map(csvCell)
      .join(","),
  )
  return [header.join(","), ...lines].join("\n")
}

function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
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

export function MovementsPage({ description }: { description: string; onNavigate?: (sectionId: string) => void }) {
  const [state, setState] = useState<MovementFilterState>(EMPTY)
  const items = useInventoryItems()
  const locations = useInventoryLocations()
  const filters = buildMovementFilters(state)
  const movements = useInventoryMovements(filters)
  const rows = useMemo(() => movements.data?.rows ?? [], [movements.data])

  const totals = useMemo(() => {
    let inValue = 0
    let outValue = 0
    for (const m of rows) {
      if (m.quantity > 0) inValue += Math.abs(m.totalCost)
      else outValue += Math.abs(m.totalCost)
    }
    return { inValue, outValue }
  }, [rows])

  const update = (patch: Partial<MovementFilterState>) => setState((s) => ({ ...s, page: 1, ...patch }))
  const toggleType = (type: MovementType) =>
    update({ types: state.types.includes(type) ? state.types.filter((t) => t !== type) : [...state.types, type] })

  const columns: DataTableColumn<Movement>[] = [
    {
      id: "date",
      header: "Fecha",
      cell: (m) => <span className="whitespace-nowrap">{new Date(m.createdAt).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>,
    },
    {
      id: "item",
      header: "Artículo",
      cell: (m) => (
        <div className="min-w-0">
          <div className="truncate">{m.itemName ?? "—"}</div>
          <div className="font-mono text-xs text-muted-foreground">{m.sku}</div>
        </div>
      ),
    },
    { id: "type", header: "Tipo", cell: (m) => MOVEMENT_LABEL[m.movementType] },
    { id: "location", header: "Bodega", cell: (m) => m.locationName ?? "—" },
    {
      id: "qty",
      header: "Cantidad",
      className: "text-right tabular-nums",
      cell: (m) => (
        <span className={signedClass(m.quantity)}>
          {m.quantity > 0 ? "+" : ""}
          {formatQuantity(m.quantity, m.unit ?? "")}
        </span>
      ),
    },
    { id: "value", header: "Valor", className: "text-right tabular-nums", cell: (m) => formatCurrency(m.totalCost) },
    { id: "reason", header: "Motivo", cell: (m) => m.reason ?? "—" },
  ]

  const typesLabel = state.types.length === 0 ? "Todos los tipos" : state.types.length === 1 ? MOVEMENT_LABEL[state.types[0]] : `${state.types.length} tipos`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimientos"
        description={description}
        actions={
          <Button variant="outline" onClick={() => downloadCsv("movimientos.csv", movementsCsv(rows))} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard title="Entradas (página)" value={formatCurrency(totals.inValue)} />
        <StatCard title="Salidas (página)" value={formatCurrency(totals.outValue)} />
        <StatCard title="Movimientos" value={movements.data?.total ?? 0} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <NativeSelect aria-label="Artículo" value={state.itemId} onChange={(e) => update({ itemId: e.target.value })}>
          <option value="">Todos los artículos</option>
          {(items.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.sku} · {i.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Bodega" value={state.locationId} onChange={(e) => update({ locationId: e.target.value })}>
          <option value="">Todas las bodegas</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-between font-normal">
              {typesLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {MOVEMENT_TYPES.map((type) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={state.types.includes(type)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => toggleType(type)}
              >
                {MOVEMENT_LABEL[type]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Input type="date" aria-label="Desde" value={state.from} onChange={(e) => update({ from: e.target.value })} />
        <Input type="date" aria-label="Hasta" value={state.to} onChange={(e) => update({ to: e.target.value })} />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(m) => m.id}
        isLoading={movements.isLoading}
        pageSize={PAGE_SIZE}
        empty={<EmptyState title="Sin movimientos" description="Ajusta los filtros o registra un movimiento desde un artículo." />}
      />
      <MovementPager page={state.page} pageSize={PAGE_SIZE} total={movements.data?.total ?? 0} onPage={(page) => setState((s) => ({ ...s, page }))} />
    </div>
  )
}
