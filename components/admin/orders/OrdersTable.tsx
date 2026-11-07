"use client"

import { useRef, type KeyboardEvent } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Bike, TriangleAlert } from "lucide-react"
import { Money, focusRing } from "@/components/cashier/cashier-ui"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/utils/helpers"
import type { AdminOrderRow, RowSort, SortKey } from "@/lib/admin/orders"
import { OrderStatusPill, initialsOf } from "./order-ui"

interface OrdersTableProps {
  rows: AdminOrderRow[]
  sort: RowSort
  onSort: (key: SortKey) => void
  selectedId: string | null
  /** Click / Enter on a row: select it and show its detail. */
  onOpen: (id: string) => void
  /** ↑/↓: move the selection without opening an overlay. */
  onMove: (id: string) => void
  pulsingIds: ReadonlySet<string>
  /** Below 768 px every row is a two-line record. */
  compact: boolean
}

const SORT_NAME: Record<SortKey, string> = { number: "número", minutes: "antigüedad", total: "total" }

/** "58 min", with the ⚠ marker (and "Atrasada" for screen readers) past the config threshold. */
function Elapsed({ row }: { row: AdminOrderRow }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap tabular-nums",
        row.late && "font-semibold text-status-warning-fg",
      )}
    >
      {row.late && (
        <>
          <TriangleAlert aria-hidden className="h-3.5 w-3.5" />
          <span className="sr-only">Atrasada, </span>
        </>
      )}
      {row.minutes} min
    </span>
  )
}

function Place({ row }: { row: AdminOrderRow }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={[row.place, row.placeDetail ?? row.address].filter(Boolean).join(" · ")}>
      {row.isDelivery && <Bike aria-hidden className="h-4 w-4 flex-none text-muted-fg" />}
      {/* Each part truncates its own text, so the ellipsis never spills out of a box. */}
      {/* "Mesa 12" keeps its width; the zone (or a long customer name) gives way. */}
      <b className={cn("truncate font-semibold text-fg", row.isDelivery ? "min-w-0" : "flex-none")}>{row.place}</b>
      {row.placeDetail && <span className="min-w-0 truncate text-muted-fg">{row.placeDetail}</span>}
    </span>
  )
}

function Waiter({ name }: { name: string | null }) {
  if (!name) return <span className="text-muted-fg">No asignado</span>
  return (
    <span className="flex min-w-0 items-center gap-2" title={name}>
      <span
        aria-hidden
        className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-strong"
      >
        {initialsOf(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}

/** Dense sortable table (≥768 px) or two-line records (phone) of the active orders. */
export function OrdersTable({ rows, sort, onSort, selectedId, onOpen, onMove, pulsingIds, compact }: OrdersTableProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    buttons.current.get(next.id)?.focus()
    onMove(next.id)
  }

  const register = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) buttons.current.set(id, node)
    else buttons.current.delete(id)
  }

  const rowButton = (row: AdminOrderRow, index: number, className: string, children: React.ReactNode) => (
    <button
      ref={register(row.id)}
      type="button"
      aria-label={`Abrir orden ${row.number ?? row.label.slice(1)}, ${row.place}`}
      aria-current={row.id === selectedId ? "true" : undefined}
      onClick={() => onOpen(row.id)}
      onKeyDown={(event) => onKeyDown(event, index)}
      className={cn(className, focusRing)}
    >
      {children}
    </button>
  )

  if (compact) {
    return (
      <ul className="divide-y divide-line" aria-label="Órdenes activas">
        {rows.map((row, index) => (
          <li
            key={row.id}
            data-testid={`admin-order-${row.id}`}
            data-selected={row.id === selectedId}
            className={cn(pulsingIds.has(row.id) && "animate-pulse-light", row.id === selectedId && "bg-brand-tint")}
          >
            {rowButton(
              row,
              index,
              "grid w-full min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left text-sm",
              <>
                <span data-testid="order-label" className="font-bold tabular-nums text-fg">
                  {row.label}
                </span>
                <Place row={row} />
                <Money className="text-right font-bold text-fg">{formatCurrency(row.total)}</Money>
                <OrderStatusPill status={row.status} />
                <span className="truncate text-muted-fg">{row.waiterName ?? "No asignado"}</span>
                <span className="text-right">
                  <Elapsed row={row} />
                </span>
              </>,
            )}
          </li>
        ))}
      </ul>
    )
  }

  const sortHeader = (key: SortKey, label: string, className?: string) => {
    const on = sort.key === key
    const Icon = on ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th
        scope="col"
        aria-sort={on ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
        className={cn("px-2 py-0 font-semibold", className)}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
          className={cn(
            "inline-flex min-h-[44px] items-center gap-1 whitespace-nowrap rounded-md px-1 hover:text-fg",
            on ? "text-brand" : "text-fg-2",
            focusRing,
          )}
        >
          {label}
          <Icon aria-hidden className="h-3.5 w-3.5" />
        </button>
      </th>
    )
  }

  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">Órdenes activas, ordenadas por {SORT_NAME[sort.key]}</caption>
      <colgroup>
        <col className="w-[76px]" />
        <col />
        <col className="hidden lg:table-column lg:w-[28%] xl:w-[22%]" />
        <col className="w-[124px]" />
        <col className="w-[92px]" />
        <col className="w-[108px]" />
      </colgroup>
      <thead className="border-b border-line bg-surface-2 text-left text-xs">
        <tr>
          {sortHeader("number", "Orden", "pl-3")}
          <th scope="col" className="px-2 font-semibold text-fg-2">
            Lugar
          </th>
          <th scope="col" className="hidden px-2 font-semibold text-fg-2 lg:table-cell">
            Mesero
          </th>
          <th scope="col" className="px-2 font-semibold text-fg-2">
            Estado
          </th>
          {sortHeader("minutes", "Tiempo")}
          {sortHeader("total", "Total", "pr-3 text-right")}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const selected = row.id === selectedId
          return (
            <tr
              key={row.id}
              data-testid={`admin-order-${row.id}`}
              data-selected={selected}
              onClick={() => onOpen(row.id)}
              className={cn(
                "h-[46px] cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2",
                selected && "bg-brand-tint shadow-[inset_3px_0_0_var(--accent)] hover:bg-brand-tint",
                pulsingIds.has(row.id) && "animate-pulse-light",
              )}
            >
              <td className="py-0 pl-3 pr-2">
                {rowButton(
                  row,
                  index,
                  "-ml-1 inline-flex min-h-[44px] items-center rounded-md px-1 font-bold tabular-nums text-fg",
                  <span data-testid="order-label">{row.label}</span>,
                )}
              </td>
              <td className="min-w-0 px-2">
                <Place row={row} />
              </td>
              <td className="hidden min-w-0 px-2 text-fg-2 lg:table-cell">
                <Waiter name={row.waiterName} />
              </td>
              <td className="px-2">
                <OrderStatusPill status={row.status} />
              </td>
              <td className="px-2">
                <Elapsed row={row} />
              </td>
              <td className="pl-2 pr-4 text-right">
                <Money className="font-medium text-fg">{formatCurrency(row.total)}</Money>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
