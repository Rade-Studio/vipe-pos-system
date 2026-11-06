"use client"

import type { CSSProperties } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import type { FloorZone } from "@/lib/floor/layout"
import { FloorTable } from "./FloorTable"
import { FLOOR_TOKENS } from "./tones"

export interface FloorMapProps {
  zone: FloorZone
  /** The zone's placed tables. */
  tables: Table[]
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  currentWaiterId?: string
  waiterNameOf?: (table: Table) => string | undefined
  /** Lean the floor back (2.5D). Flat under prefers-reduced-motion. */
  tilt?: boolean
  className?: string
}

const WALL_POSITION = {
  top: "left-1/2 top-2 -translate-x-1/2",
  bottom: "bottom-2 left-1/2 -translate-x-1/2",
  left: "left-2 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl] rotate-180",
  right: "right-2 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl]",
} as const

/**
 * One zone's floor at its aspect ratio, with wall labels and its tables
 * (design/system.md "Table (mesa) component — 2.5D floor map"). Sized by its
 * container: wrap it in a scroller to zoom.
 */
export function FloorMap({
  zone,
  tables,
  selectedTableId,
  onSelectTable,
  currentWaiterId,
  waiterNameOf,
  tilt = true,
  className,
}: FloorMapProps) {
  return (
    <div className={cn(FLOOR_TOKENS, tilt && "[perspective:2400px] [perspective-origin:50%_30%]", className)}>
      <div
        role="group"
        aria-label={`Plano de ${zone.name}, ${tables.length} mesas`}
        className={cn(
          "relative w-full rounded-card-lg border border-[var(--floor-edge)] bg-[var(--floor)]",
          tilt && "motion-safe:[transform:rotateX(18deg)]",
        )}
        style={
          {
            aspectRatio: String(zone.aspect),
            containerType: "inline-size",
            backgroundImage:
              "linear-gradient(var(--floor-grid) 1px, transparent 1px), linear-gradient(90deg, var(--floor-grid) 1px, transparent 1px)",
            backgroundSize: "5cqi 5cqi",
            boxShadow: "inset 0 2px 12px rgba(0,0,0,.12), 0 40px 80px -40px var(--floor-shadow)",
          } as CSSProperties
        }
      >
        {zone.labels.map((label, index) => (
          <span
            key={`${label.side}-${index}`}
            aria-hidden
            className={cn(
              "pointer-events-none absolute whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.18em] text-muted-fg",
              WALL_POSITION[label.side],
            )}
          >
            {label.text}
          </span>
        ))}
        {tables.map((table) => (
          <FloorTable
            key={table.id}
            table={table}
            aspect={zone.aspect}
            selected={selectedTableId === table.id}
            mine={!!currentWaiterId && table.waiter === currentWaiterId}
            waiterName={waiterNameOf?.(table)}
            onSelect={onSelectTable}
          />
        ))}
      </div>
    </div>
  )
}
