"use client"

import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import type { FloorZone } from "@/lib/floor/layout"
import { FloorTable, type FloorMode } from "./FloorTable"
import { FLOOR_TOKENS } from "./tones"

export interface FloorMapProps {
  zone: FloorZone
  /** The zone's placed tables. */
  tables: Table[]
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  currentWaiterId?: string
  waiterNameOf?: (table: Table) => string | undefined
  /** Live mode: time since the table's open order started (T22). */
  elapsedOf?: (table: Table) => string | null | undefined
  /** Lean the floor back (2.5D). Flat under prefers-reduced-motion and in edit mode. */
  tilt?: boolean
  mode?: FloorMode
  /** Edit mode: a dragged table's new centre, as unsnapped fractions of the floor. */
  onMoveTable?: (tableId: string, x: number, y: number) => void
  /** Edit mode: an arrow key on a table (`big` with Shift). */
  onNudgeTable?: (tableId: string, key: string, big: boolean) => void
  className?: string
}

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])

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
  elapsedOf,
  tilt = true,
  mode = "live",
  onMoveTable,
  onNudgeTable,
  className,
}: FloorMapProps) {
  const floorRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const leans = tilt && mode !== "edit"

  const pointerFraction = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = floorRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const startDrag = (tableId: string, event: PointerEvent<HTMLButtonElement>) => {
    if (!onMoveTable || event.button !== 0) return
    const table = tables.find((candidate) => candidate.id === tableId)
    const at = pointerFraction(event)
    if (!table || !at) return
    drag.current = { id: tableId, dx: at.x - (table.x ?? 0.5), dy: at.y - (table.y ?? 0.5) }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onSelectTable(tableId)
  }

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    const at = current && pointerFraction(event)
    if (!current || !at) return
    onMoveTable?.(current.id, at.x - current.dx, at.y - current.dy)
  }

  const endDrag = () => {
    drag.current = null
  }

  const keyDown = (tableId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!onNudgeTable || !ARROW_KEYS.has(event.key)) return
    event.preventDefault()
    onNudgeTable(tableId, event.key, event.shiftKey)
  }

  return (
    <div className={cn(FLOOR_TOKENS, leans && "[perspective:2400px] [perspective-origin:50%_30%]", className)}>
      <div
        ref={floorRef}
        role="group"
        onPointerMove={onMoveTable ? moveDrag : undefined}
        onPointerUp={onMoveTable ? endDrag : undefined}
        onPointerCancel={onMoveTable ? endDrag : undefined}
        aria-label={`Plano de ${zone.name}, ${tables.length} mesas`}
        className={cn(
          "relative w-full rounded-card-lg border border-[var(--floor-edge)] bg-[var(--floor)]",
          leans && "motion-safe:[transform:rotateX(18deg)]",
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
            elapsed={elapsedOf?.(table)}
            onSelect={onSelectTable}
            mode={mode}
            onPointerDown={onMoveTable ? startDrag : undefined}
            onKeyDown={onNudgeTable ? keyDown : undefined}
          />
        ))}
      </div>
    </div>
  )
}
