"use client"

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react"
import { AlarmClock, Bookmark, Check, Clock, ConciergeBell, Hand, Receipt, ShoppingBag, User, type LucideIcon } from "lucide-react"
import type { Table, TableStatus } from "@/types"
import { cn } from "@/lib/utils"
import { chairPositions, initials, isInactive, seatsText, tableAccessibleName, tableBox } from "@/lib/floor/layout"
import { SHAPE_LABELS } from "@/lib/floor/editor"
import { isOldElapsed } from "@/lib/floor/live"
import { alertIconKind, alertText, type TableAlert, type TableAlertKind } from "@/lib/floor/alerts"
import { reservationLine } from "@/lib/tables/reservation"
import { INACTIVE_TONE, toneClasses } from "./tones"

interface FloorTableProps {
  table: Table
  /** Width / height of the zone floor. */
  aspect: number
  selected: boolean
  /** The signed-in waiter's table: "Tú" badge. */
  mine: boolean
  waiterName?: string
  /** Time since the open order started ("18 min", T22); in the accessible name (no pill, ux-carta-mesero S5). */
  elapsed?: string | null
  /** Live mode: pending carta requests on the table (ux-carta-mesero S4). */
  alert?: TableAlert
  onSelect: (tableId: string) => void
  /** live: tone, waiter badge, old-order and carta badges; edit: shape and chairs only (admin editor); mini: number and a status icon. */
  mode?: FloorMode
  onPointerDown?: (tableId: string, event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown?: (tableId: string, event: KeyboardEvent<HTMLButtonElement>) => void
}

export type FloorMode = "live" | "edit" | "mini"

const STATUS_ICON: Record<TableStatus, LucideIcon> = {
  available: Check,
  reserved: Bookmark,
  occupied: User,
  kitchen: Clock,
  served: ConciergeBell,
}

/** "Mesa 4, Redonda, 4 sillas": the editor names a table by its layout, not its status. */
export const editAccessibleName = (table: Table): string =>
  [`Mesa ${table.number}`, SHAPE_LABELS[table.shape ?? "square"], seatsText(table.seats)].join(", ")

const ALERT_ICON: Record<TableAlertKind, LucideIcon> = { bill: Receipt, waiter: Hand, proposal: ShoppingBag }

const TOP_RADIUS = { round: "rounded-full", bar: "rounded-[8px]", square: "rounded-[18px]", rect: "rounded-[18px]" } as const

/**
 * One table on the floor: tabletop at its x/y, rotated, chairs from `seats`,
 * number and waiter badge. The state is the tabletop colour only (the
 * floor's legend and the accessible name say it in words): pills under
 * neighbouring tables overlapped (ux-carta-mesero S5). Selection is the
 * `aria-pressed` accent ring; keyboard focus is a dashed outline, so they
 * never look alike.
 */
export function FloorTable({
  table,
  aspect,
  selected,
  mine,
  waiterName,
  elapsed,
  alert: alertProp,
  onSelect,
  mode = "live",
  onPointerDown,
  onKeyDown,
}: FloorTableProps) {
  const box = tableBox(table, aspect)
  const chairs = chairPositions(table.shape, table.seats)
  const inactive = isInactive(table)
  const tone = inactive ? INACTIVE_TONE : toneClasses(table.status)
  const elapsedChip = mode === "live" && !inactive ? elapsed : null
  // S2: a reserved table names its reservation in its name.
  const reservation = mode === "live" ? reservationLine(table) : null
  const alert = mode === "live" ? alertProp : undefined
  const AlertIcon = alert ? ALERT_ICON[alertIconKind(alert)] : null
  // S3: an order open 12 h or more gets the warning badge.
  const oldOrder = !reservation && isOldElapsed(elapsedChip)
  const shadow = [
    selected ? "0 0 0 3px var(--floor), 0 0 0 6px var(--accent)" : null,
    "0 6px 0 -1px var(--thick)",
    "0 18px 22px -10px var(--floor-shadow)",
    "inset 0 1px 0 rgba(255,255,255,.18)",
  ]
    .filter(Boolean)
    .join(", ")
  const badge = mode !== "live" ? null : mine ? "Tú" : table.waiter || waiterName ? initials(waiterName) : null
  const StatusIcon = STATUS_ICON[table.status]
  // The mini map only shows: its tables are pictures, not (too small) buttons.
  const interactive = mode !== "mini"
  const Root = (interactive ? "button" : "span") as "button"

  return (
    // data-qa-ignore: chairs, the waiter badge and the status chip are drawn
    // around the tabletop on purpose (design/system.md); the floor is checked.
    <Root
      data-qa-ignore
      aria-label={
        mode === "edit"
          ? editAccessibleName(table)
          : [tableAccessibleName(table, waiterName, elapsedChip), reservation, alert ? alertText(alert) : null]
              .filter(Boolean)
              .join(", ")
      }
      data-inactive={inactive && mode !== "edit" ? "true" : undefined}
      {...(interactive
        ? {
            type: "button" as const,
            "aria-pressed": selected,
            onClick: () => onSelect(table.id),
            onPointerDown: onPointerDown ? (event: PointerEvent<HTMLButtonElement>) => onPointerDown(table.id, event) : undefined,
            onKeyDown: onKeyDown ? (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(table.id, event) : undefined,
          }
        : { role: "img" })}
      className={cn(
        "group absolute grid place-items-center -translate-x-1/2 -translate-y-1/2 rounded-[18px] text-fg focus-visible:outline-none",
        mode === "mini" ? "min-h-[24px] min-w-[24px]" : "min-h-[44px] min-w-[44px]",
        mode === "edit" && "cursor-grab touch-none select-none active:cursor-grabbing",
        inactive && mode !== "edit" && "opacity-70",
      )}
      style={{ ...box, "--cs": "clamp(10px, 2.6cqi, 22px)" } as CSSProperties}
    >
      <span
        data-tabletop
        aria-hidden
        className="absolute inset-0"
        style={{ transform: `rotate(${table.rotation ?? 0}deg)` }}
      >
        {chairs.map((chair, index) => (
          <span
            key={index}
            data-chair
            className={cn(
              "absolute h-[var(--cs)] w-[var(--cs)] -translate-x-1/2 -translate-y-1/2 border border-[var(--chair-line)] bg-[var(--chair)]",
              table.shape === "bar" ? "rounded-full" : "rounded-[7px]",
            )}
            style={{ left: chair.left, top: chair.top, boxShadow: "0 4px 0 -1px var(--thick)" }}
          />
        ))}
        <span
          className={cn(
            "absolute inset-0 border-[1.5px] transition-transform motion-safe:group-hover:-translate-y-0.5",
            TOP_RADIUS[table.shape ?? "square"],
            mode === "edit" ? "border-line-strong bg-surface text-fg" : tone.fill,
            "group-focus-visible:outline-dashed group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[10px] group-focus-visible:outline-focus",
          )}
          style={{ boxShadow: shadow }}
        />
      </span>

      <span
        className={cn(
          "relative z-10 inline-flex items-center gap-0.5 font-semibold leading-none tracking-tight tabular-nums",
          mode === "mini" ? "text-[clamp(10px,3cqi,16px)]" : "text-[clamp(15px,3.4cqi,30px)]",
        )}
      >
        {table.number}
        {mode === "mini" && <StatusIcon aria-hidden className="h-3 w-3 shrink-0" strokeWidth={2.6} />}
      </span>

      {badge && (
        <span
          className={cn(
            "absolute -left-3 -top-2 z-20 grid h-6 min-w-6 place-items-center rounded-full border px-1 text-[11px] font-semibold leading-none lg:h-7 lg:min-w-7",
            mine ? "border-brand bg-brand text-brand-contrast" : "border-line-strong bg-surface-2 text-fg",
          )}
        >
          {badge}
        </span>
      )}

      {oldOrder && (
        // S3: an order open 12 h or more; its age is in the accessible name.
        <span
          data-testid="table-old"
          aria-hidden
          className="absolute -bottom-2 -right-2 z-20 grid h-[clamp(18px,3cqi,26px)] w-[clamp(18px,3cqi,26px)] place-items-center rounded-full border border-status-warning-line bg-status-warning-bg text-status-warning-fg shadow-sm"
        >
          <AlarmClock className="h-[60%] w-[60%]" strokeWidth={2.4} />
        </span>
      )}

      {alert && AlertIcon && (
        // ux-carta-mesero S4: a carta request waits on this table (top-right; top-left is the waiter badge).
        <span
          data-testid="table-alert"
          data-kind={alertIconKind(alert)}
          aria-hidden
          className="absolute -right-3 -top-2 z-30 grid h-[clamp(22px,3.4cqi,30px)] min-w-[clamp(22px,3.4cqi,30px)] place-items-center gap-0.5 rounded-full border-2 border-[var(--floor)] bg-brand px-1 text-[11px] font-bold leading-none text-brand-contrast shadow-md motion-safe:animate-pulse motion-reduce:animate-none [grid-auto-flow:column]"
        >
          <AlertIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          {alert.count > 1 && <span className="tabular-nums">{alert.count}</span>}
        </span>
      )}
    </Root>
  )
}
