"use client"

import type { CSSProperties } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { chairPositions, initials, tableAccessibleName, tableBox } from "@/lib/floor/layout"
import { StatusChip } from "./StatusChip"
import { toneClasses } from "./tones"

interface FloorTableProps {
  table: Table
  /** Width / height of the zone floor. */
  aspect: number
  selected: boolean
  /** The signed-in waiter's table: "Tú" badge. */
  mine: boolean
  waiterName?: string
  onSelect: (tableId: string) => void
}

const TOP_RADIUS = { round: "rounded-full", bar: "rounded-pill", square: "rounded-[18px]", rect: "rounded-[18px]" } as const

/**
 * One table on the floor: tabletop at its x/y, rotated, chairs from `seats`,
 * number, waiter badge and the status chip under it. Selection is the
 * `aria-pressed` accent ring; keyboard focus is a dashed outline, so they
 * never look alike.
 */
export function FloorTable({ table, aspect, selected, mine, waiterName, onSelect }: FloorTableProps) {
  const box = tableBox(table, aspect)
  const chairs = chairPositions(table.shape, table.seats)
  const tone = toneClasses(table.status)
  const shadow = [
    selected ? "0 0 0 3px var(--floor), 0 0 0 6px var(--accent)" : null,
    "0 6px 0 -1px var(--thick)",
    "0 18px 22px -10px var(--floor-shadow)",
    "inset 0 1px 0 rgba(255,255,255,.18)",
  ]
    .filter(Boolean)
    .join(", ")
  const badge = mine ? "Tú" : table.waiter ? initials(waiterName) : null

  return (
    // data-qa-ignore: chairs, the waiter badge and the status chip are drawn
    // around the tabletop on purpose (design/system.md); the floor is checked.
    <button
      type="button"
      data-qa-ignore
      aria-pressed={selected}
      aria-label={tableAccessibleName(table, waiterName)}
      onClick={() => onSelect(table.id)}
      className="group absolute grid min-h-[44px] place-items-center min-w-[44px] -translate-x-1/2 -translate-y-1/2 rounded-[18px] text-fg focus-visible:outline-none"
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
            tone.fill,
            "group-focus-visible:outline-dashed group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[10px] group-focus-visible:outline-focus",
          )}
          style={{ boxShadow: shadow }}
        />
      </span>

      <span className="relative z-10 text-[clamp(15px,3.4cqi,30px)] font-semibold leading-none tracking-tight tabular-nums">
        {table.number}
      </span>

      {badge && (
        <span
          className={cn(
            "absolute -left-2 -top-2 z-20 grid h-6 min-w-6 place-items-center rounded-full border px-1 text-[11px] font-semibold leading-none sm:h-7 sm:min-w-7",
            mine ? "border-brand bg-brand text-brand-contrast" : "border-line-strong bg-surface-2 text-fg",
          )}
        >
          {badge}
        </span>
      )}

      <StatusChip
        status={table.status}
        className={cn(
          "absolute left-1/2 top-full z-20 -translate-x-1/2 px-1.5 text-[11px] shadow-sm sm:text-xs",
          chairs.length > 0 ? "mt-[calc(var(--cs)*1.3+4px)]" : "mt-2",
        )}
      />
    </button>
  )
}
