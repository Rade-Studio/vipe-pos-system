"use client"

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react"
import { useQuery } from "@tanstack/react-query"
import { Pencil, X } from "lucide-react"
import type { Order, Table, TableStatus } from "@/types"
import { cn } from "@/lib/utils"
import { TABLE_STATUS, initials, isPlaced, statusLabel, tableBox } from "@/lib/floor/layout"
import { liveInfoByTable, longestWaiting, type LiveTableInfo } from "@/lib/admin/floor/live"
import { requestEditorZone } from "@/lib/admin/floor/editor-zone"
import { adminOrdersQueryKey, fetchActiveAdminOrders, mergeOrderLists, type AdminOrder } from "@/lib/admin/orders"
import { useTableStore } from "@/store/useTableStore"
import { useZones } from "@/hooks/use-zones"
import { FloorTable } from "@/components/floor/FloorTable"
import { StatusChip } from "@/components/floor/StatusChip"
import { FLOOR_TOKENS, toneClasses } from "@/components/floor/tones"
import { Button } from "@/components/ui/button"
import { reservationLine } from "@/lib/tables/reservation"
import { Skeleton } from "@/components/ui/skeleton"

/** Elapsed minutes are re-read from the clock this often. */
const TICK_MS = 30_000
const WAITING_ROWS = 3
const EMPTY_ORDERS: AdminOrder[] = []

const TAB =
  "inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-pill border px-4 text-sm font-medium focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

/** The waiter on the open order, else the one the table is assigned to. */
const waiterOf = (table: Table, info: LiveTableInfo | undefined): string | undefined =>
  info?.waiterName ?? (table.waiter ? table.waiter_name : undefined)

/** "Mesa 2, En cocina, 18 min, Camila Montoya" (", inactiva" for an inactive table). */
const liveName = (table: Table, info: LiveTableInfo | undefined): string =>
  [
    `Mesa ${table.number}`,
    statusLabel(table.status),
    info ? `${info.minutes} min` : null,
    waiterOf(table, info),
    table.isActive === false ? "inactiva" : null,
  ]
    .filter(Boolean)
    .join(", ")

function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

function Details({ table, info, onClose }: { table: Table; info: LiveTableInfo | undefined; onClose: () => void }) {
  const headingId = useId()
  const rows: [string, string][] = info
    ? [
        ["Mesero", waiterOf(table, info) ?? "Sin mesero"],
        ["Tiempo", `${info.minutes} min`],
        ["Orden", info.orderNumber ? `#${info.orderNumber}` : "Sin número"],
      ]
    : [["Mesero", waiterOf(table, info) ?? "Sin mesero"]]
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface-2 p-3 text-sm">
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="min-w-0 flex-1 truncate font-semibold">
          Mesa {table.number}
        </h3>
        <StatusChip status={table.status} />
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Cerrar detalles" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {table.isActive === false && <p className="text-xs text-muted-fg">Inactiva: no recibe órdenes nuevas.</p>}
      {reservationLine(table) && <p className="text-sm font-medium [overflow-wrap:anywhere]">{reservationLine(table)}</p>}
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-muted-fg">{label}</dt>
            <dd className="min-w-0 truncate font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {!info && <p className="text-xs text-muted-fg">Sin orden abierta.</p>}
    </section>
  )
}

/**
 * "Sala en vivo" (T5, T26; design/admin-shell-redesign/01): the zone's floor
 * small, each table with the minutes since its open order and the waiter's
 * initials; a table opens its details; "Editar plano" opens the editor on
 * the zone shown. Own component: only it re-renders on table events.
 */
export function LiveRoomCard({ orders, onNavigate }: { orders: (Order & { waiterName?: string })[]; onNavigate?: (sectionId: string) => void }) {
  const headingId = useId()
  const tables = useTableStore((s) => s.tables)
  const { data: zones = [], isLoading } = useZones()
  const now = useNow()
  const [zoneId, setZoneId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const zoneIds = useMemo(() => new Set(zones.map((zone) => zone.id)), [zones])
  // The shell reads the admin's active orders (active, kitchen, delivered with
  // `include=table,waiter`) only for Órdenes; the card shares that query so an
  // unsent order shows its minutes and its own waiter. Its rows win over the
  // store snapshot passed in, which has no waiter name and no `active` orders.
  const { data: queried = EMPTY_ORDERS } = useQuery<AdminOrder[]>({
    queryKey: adminOrdersQueryKey,
    queryFn: fetchActiveAdminOrders,
    staleTime: 15_000,
  })
  const merged = useMemo(() => mergeOrderLists<Order & { waiterName?: string }>(queried, orders), [queried, orders])
  const info = useMemo(() => liveInfoByTable(merged, now), [merged, now])
  const zone = zones.find((candidate) => candidate.id === zoneId) ?? zones[0]
  const placed = useMemo(() => tables.filter((table) => isPlaced(table, zoneIds)), [tables, zoneIds])
  const zoneTables = zone ? placed.filter((table) => table.zoneId === zone.id).sort((a, b) => a.number - b.number) : []
  const selected = tables.find((table) => table.id === selectedId) ?? null
  const waiting = longestWaiting(info, WAITING_ROWS, new Set(zoneTables.map((table) => table.id)))
  const counts = useMemo(() => {
    const out = {} as Record<TableStatus, number>
    for (const status of Object.keys(TABLE_STATUS) as TableStatus[]) out[status] = 0
    for (const table of tables) out[table.status] = (out[table.status] ?? 0) + 1
    return out
  }, [tables])

  const editPlan = () => {
    requestEditorZone(zone?.id)
    onNavigate?.("tables")
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-card-lg border border-line bg-surface p-4 text-fg [container-type:inline-size] dark:backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-medium">
            Sala en vivo
          </h2>
          <p className="text-xs text-muted-fg">
            <span className="tabular-nums">
              {counts.available} de {tables.length}
            </span>{" "}
            mesas libres · {zones.length} {zones.length === 1 ? "zona" : "zonas"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-11 rounded-full border-line-strong bg-transparent px-4" onClick={editPlan}>
          <Pencil className="mr-1.5 h-4 w-4" aria-hidden />
          Editar plano
        </Button>
      </div>

      {zones.length > 0 && zone && (
        <div role="tablist" aria-label="Zonas" className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {zones.map((candidate) => {
            const active = candidate.id === zone.id
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setZoneId(candidate.id)
                  setSelectedId(null)
                }}
                className={cn(TAB, active ? "border-brand-line bg-brand-tint text-fg" : "border-line bg-surface-2 text-fg-2")}
              >
                {candidate.name}
                <span className="text-xs tabular-nums text-muted-fg">
                  {placed.filter((table) => table.zoneId === candidate.id).length}
                  <span className="sr-only"> mesas</span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 [@container(min-width:620px)]:grid-cols-[minmax(0,1.5fr)_minmax(200px,1fr)]">
        <div className="min-w-0">
          {isLoading ? (
            <Skeleton className="aspect-[1.6] w-full rounded-card-lg" />
          ) : zone ? (
            <div className={FLOOR_TOKENS}>
              <div
                role="group"
                aria-label={`Plano en vivo de ${zone.name}, ${zoneTables.length} mesas`}
                className="relative mx-auto w-full rounded-card-lg border border-[var(--floor-edge)] bg-[var(--floor)]"
                style={
                  {
                    aspectRatio: String(zone.aspect),
                    containerType: "inline-size",
                    backgroundImage:
                      "linear-gradient(var(--floor-grid) 1px, transparent 1px), linear-gradient(90deg, var(--floor-grid) 1px, transparent 1px)",
                    backgroundSize: "5cqi 5cqi",
                  } as CSSProperties
                }
              >
                {/* The shared mini drawing (a picture), with a button over each table to select it. */}
                <div aria-hidden className="pointer-events-none absolute inset-0">
                  {zoneTables.map((table) => (
                    <span key={table.id} className={cn("contents", table.isActive === false && "[&>span]:opacity-50 [&_[data-tabletop]>span:last-child]:border-dashed")}>
                      <FloorTable table={table} aspect={zone.aspect} selected={table.id === selectedId} mine={false} onSelect={() => undefined} mode="mini" />
                    </span>
                  ))}
                </div>
                {zoneTables.map((table) => {
                  const live = info.get(table.id)
                  const box = tableBox(table, zone.aspect)
                  const waiter = waiterOf(table, live)
                  return (
                    <button
                      key={table.id}
                      type="button"
                      // data-qa-ignore: the minutes and initials badges sit on the table's corners on purpose.
                      data-qa-ignore
                      aria-label={liveName(table, live)}
                      aria-pressed={table.id === selectedId}
                      onClick={() => setSelectedId(table.id === selectedId ? null : table.id)}
                      className="absolute z-10 min-h-[32px] min-w-[32px] -translate-x-1/2 -translate-y-1/2 rounded-[12px] focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                      style={box}
                    >
                      {waiter && (
                        <span className="absolute -left-2 -top-2 grid h-6 min-w-6 place-items-center rounded-full border border-line-strong bg-surface-2 px-1 text-[10.5px] font-semibold leading-none text-fg">
                          {initials(waiter)}
                        </span>
                      )}
                      {live && (
                        <span
                          className={cn(
                            "absolute -bottom-2.5 -right-3 whitespace-nowrap rounded-pill border px-1.5 text-[10.5px] font-medium leading-[18px] tabular-nums",
                            toneClasses(table.status).fill,
                          )}
                        >
                          {live.minutes} min
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="rounded-card border border-dashed border-line-strong bg-surface-2 p-4 text-sm text-muted-fg">
              Aún no hay un plano configurado. Crea zonas y ubica las mesas desde Mesas.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <ul aria-label="Estados de las mesas" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-2">
            {(Object.keys(TABLE_STATUS) as TableStatus[]).map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2.5 w-2.5 rounded-full", toneClasses(status).dot)} />
                <span>{TABLE_STATUS[status].label}</span>
                <span className="font-medium tabular-nums text-fg">{counts[status]}</span>
              </li>
            ))}
          </ul>
          {selected ? (
            <Details table={selected} info={info.get(selected.id)} onClose={() => setSelectedId(null)} />
          ) : waiting.length > 0 ? (
            <div className="min-w-0">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-fg">Esperando más tiempo</h3>
              <ul aria-label="Esperando más tiempo" className="divide-y divide-line text-sm">
                {waiting.map((id) => {
                  const table = zoneTables.find((candidate) => candidate.id === id)
                  const live = info.get(id)
                  if (!table || !live) return null
                  return (
                    <li key={id} className="flex min-w-0 items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <b className="block font-semibold">Mesa {table.number}</b>
                        <small className="block truncate text-xs text-muted-fg">{waiterOf(table, live) ?? "Sin mesero"}</small>
                      </span>
                      <span className={cn("shrink-0 whitespace-nowrap rounded-pill border px-2 text-xs font-medium leading-6 tabular-nums", toneClasses(table.status).fill)}>
                        {live.minutes} min
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-fg">Sin mesas esperando en esta zona. Toca una mesa para ver sus detalles.</p>
          )}
        </div>
      </div>
    </section>
  )
}
