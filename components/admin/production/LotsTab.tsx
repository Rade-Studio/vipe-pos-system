"use client"

import { useMemo, useState } from "react"
import { Download } from "lucide-react"
import { formatMoney } from "@/components/admin/inventory-shared"
import { ExpiryBadge, NativeSelect } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useProductionBatches } from "@/hooks/inventory"
import { batchesCsv, clockOf } from "@/lib/inventory/production-csv"
import { addDaysIso, dayLabel, expiresSoon, filterBatches, groupBatchesByDay, localIsoDate } from "@/lib/inventory/production-sheet"
import { formatQuantity } from "@/lib/inventory/units"
import type { InventoryItem } from "@/lib/api/inventory/types"
import { cn } from "@/lib/utils"
import { downloadCsv, SearchField } from "./production-ui"

const DEFAULT_DAYS = 7
const MAX_RANGE_DAYS = 366
const MS_PER_DAY = 86_400_000

const spanDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY)

const rangeErrorOf = (from: string, to: string) =>
  !from || !to
    ? "Elige las dos fechas."
    : from > to
      ? "La fecha Desde debe ser anterior a Hasta."
      : spanDays(from, to) > MAX_RANGE_DAYS
        ? `El rango no puede superar ${MAX_RANGE_DAYS} días.`
        : null

/** S5: lots by produced day, with search, range, preparation and "Vence pronto". */
export function LotsTab({ preps }: { preps: InventoryItem[] }) {
  const now = new Date()
  const today = localIsoDate(now)
  const [from, setFrom] = useState(addDaysIso(today, -DEFAULT_DAYS))
  const [to, setTo] = useState(today)
  const [itemId, setItemId] = useState("")
  const [query, setQuery] = useState("")
  const [soon, setSoon] = useState(false)

  const rangeError = rangeErrorOf(from, to)
  // An invalid range keeps the last valid query on screen.
  const [range, setRange] = useState({ from, to })
  const changeRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    if (!rangeErrorOf(nextFrom, nextTo)) setRange({ from: nextFrom, to: nextTo })
  }
  const batchesQuery = useProductionBatches({ ...range, limit: 500, ...(itemId ? { itemId } : {}) })

  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data])
  const filtered = filterBatches(batches, { query, expiringSoon: soon, today: now })
  const groups = groupBatchesByDay(filtered)
  const soonCount = batches.filter((b) => expiresSoon(b, now)).length
  const total = groups.reduce((sum, g) => sum + g.totalCost, 0)
  const yesterday = addDaysIso(today, -1)
  const sortedPreps = [...preps].sort((a, b) => a.name.localeCompare(b.name, "es"))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField label="Buscar lote o preparación" placeholder="Buscar lote o preparación…" value={query} onChange={setQuery} />
        <div className="space-y-1.5">
          <Label htmlFor="lots-from">Desde</Label>
          <Input id="lots-from" type="date" className="h-11" value={from} max={today} onChange={(e) => changeRange(e.target.value, to)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lots-to">Hasta</Label>
          <Input id="lots-to" type="date" className="h-11" value={to} max={today} onChange={(e) => changeRange(from, e.target.value)} />
        </div>
        <div className="min-w-48 space-y-1.5">
          <Label htmlFor="lots-prep">Preparación</Label>
          <NativeSelect id="lots-prep" className="h-11" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Todas</option>
            {sortedPreps.map((prep) => (
              <option key={prep.id} value={prep.id}>
                {prep.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <button
          type="button"
          aria-pressed={soon}
          onClick={() => setSoon((v) => !v)}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            soon && "border-primary/50 bg-primary/10 text-foreground",
          )}
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-yellow-500" />
          Vence pronto <span className="tabular-nums">{soonCount}</span>
        </button>
        <Button
          variant="outline"
          className="min-h-11 sm:ml-auto"
          disabled={filtered.length === 0}
          onClick={() => downloadCsv(`lotes-${range.from}-a-${range.to}.csv`, batchesCsv(groups.flatMap((g) => g.batches)))}
        >
          <Download aria-hidden />
          Exportar CSV
        </Button>
      </div>
      {rangeError && (
        <p role="alert" className="text-sm text-destructive">
          {rangeError}
        </p>
      )}

      <div className="rounded-lg border bg-card">
        <table className="block w-full text-sm md:table" aria-label="Lotes agrupados por día, con total de lotes y costo del día">
          <thead className="hidden md:table-header-group">
            <tr className="text-xs text-muted-foreground">
              {["Hora", "Preparación", "Cantidad", "Lote", "Vence", "Responsable", "Total"].map((label, i) => (
                <th
                  key={label}
                  scope="col"
                  className={cn("sticky top-0 z-10 h-10 border-b bg-card px-3 text-left font-medium", (i === 2 || i === 6) && "text-right")}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          {batchesQuery.isLoading ? (
            <tbody className="block md:table-row-group">
              <tr className="block md:table-row">
                <td colSpan={7} className="block p-3 md:table-cell">
                  <Skeleton className="h-24" />
                </td>
              </tr>
            </tbody>
          ) : groups.length === 0 ? (
            <tbody className="block md:table-row-group">
              <tr className="block md:table-row">
                <td colSpan={7} className="block px-3 py-6 text-center text-muted-foreground md:table-cell">
                  Ningún lote coincide con los filtros.
                </td>
              </tr>
            </tbody>
          ) : (
            groups.map((group) => (
              <tbody key={group.day} className="block md:table-row-group">
                <tr className="block bg-muted/50 md:table-row">
                  <th colSpan={7} scope="rowgroup" className="flex items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold md:table-cell">
                    {group.day === today ? "Hoy · " : group.day === yesterday ? "Ayer · " : ""}
                    {dayLabel(group.day)}
                    <span className="float-right font-normal text-muted-foreground">
                      {group.batches.length} {group.batches.length === 1 ? "lote" : "lotes"} · <span className="tabular-nums">{formatMoney(group.totalCost)}</span>
                    </span>
                  </th>
                </tr>
                {group.batches.map((b) => (
                  <tr
                    key={b.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b px-3 py-2.5 md:table-row md:p-0"
                  >
                    <td className="order-5 block text-xs tabular-nums text-muted-foreground md:table-cell md:px-3 md:py-1.5 md:text-sm">{clockOf(b.createdAt)}</td>
                    <td className="order-1 block font-semibold md:table-cell md:px-3 md:py-1.5 md:font-medium">{b.itemName ?? "—"}</td>
                    <td className="order-3 block tabular-nums md:table-cell md:px-3 md:py-1.5 md:text-right">{formatQuantity(b.quantity, b.unit ?? "")}</td>
                    <td className="order-4 block justify-self-end font-mono text-xs md:table-cell md:px-3 md:py-1.5">{b.lotCode ?? "—"}</td>
                    <td className="order-7 block md:table-cell md:px-3 md:py-1.5">
                      <ExpiryBadge expiresOn={b.expiresOn} today={now} />
                    </td>
                    <td className="order-6 block justify-self-end text-xs text-muted-foreground md:table-cell md:px-3 md:py-1.5 md:text-sm">
                      {b.producedBy?.name ?? "—"}
                    </td>
                    <td className="order-2 block justify-self-end font-semibold tabular-nums md:table-cell md:px-3 md:py-1.5 md:text-right">
                      {formatMoney(b.totalCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))
          )}
        </table>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "lote" : "lotes"} · {groups.length} {groups.length === 1 ? "día" : "días"} · costo {formatMoney(total)}
      </p>
    </div>
  )
}
