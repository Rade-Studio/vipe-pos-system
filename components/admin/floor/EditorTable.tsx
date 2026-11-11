"use client"

import type { CSSProperties, KeyboardEvent, PointerEvent } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { chairPositions, tableBox } from "@/lib/floor/layout"
import { editAccessibleName } from "@/components/floor/FloorTable"

interface EditorTableProps {
  table: Table
  aspect: number
  selected: boolean
  onClick: (tableId: string) => void
  onPointerDown: (tableId: string, event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (tableId: string, event: KeyboardEvent<HTMLButtonElement>) => void
}

const TOP_RADIUS = { round: "rounded-full", bar: "rounded-[8px]", square: "rounded-[18px]", rect: "rounded-[18px]" } as const

/** "Mesa 4, Redonda, 4 sillas, inactiva". */
export const editorTableName = (table: Table): string => editAccessibleName(table) + (table.isActive === false ? ", inactiva" : "")

/**
 * One table of the admin editor (T26): the shared floor drawing in its edit
 * look (shape and chairs, no status) plus the inactive look of the design
 * (dashed, faded). Touch keeps pan and pinch (`manipulation`): the canvas
 * picks a table up only after a long press.
 */
export function EditorTable({ table, aspect, selected, onClick, onPointerDown, onKeyDown }: EditorTableProps) {
  const chairs = chairPositions(table.shape, table.seats)
  const inactive = table.isActive === false
  const shadow = [
    selected ? "0 0 0 3px var(--floor), 0 0 0 6px var(--accent)" : null,
    inactive ? null : "0 6px 0 -1px var(--thick)",
    inactive ? null : "0 18px 22px -10px var(--floor-shadow)",
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <button
      type="button"
      data-qa-ignore
      data-table-id={table.id}
      aria-label={editorTableName(table)}
      aria-pressed={selected}
      onClick={() => onClick(table.id)}
      onPointerDown={(event) => onPointerDown(table.id, event)}
      onKeyDown={(event) => onKeyDown(table.id, event)}
      className={cn(
        "group absolute grid min-h-[44px] min-w-[44px] -translate-x-1/2 -translate-y-1/2 cursor-grab select-none place-items-center rounded-[18px] text-fg",
        "touch-manipulation [-webkit-touch-callout:none] focus-visible:outline-none active:cursor-grabbing",
      )}
      style={{ ...tableBox(table, aspect), "--cs": "clamp(10px, 2.6cqi, 22px)" } as CSSProperties}
    >
      <span aria-hidden className={cn("absolute inset-0", inactive && "opacity-60")} style={{ transform: `rotate(${table.rotation ?? 0}deg)` }}>
        {chairs.map((chair, index) => (
          <span
            key={index}
            data-chair
            className={cn(
              "absolute h-[var(--cs)] w-[var(--cs)] -translate-x-1/2 -translate-y-1/2 border border-[var(--chair-line)] bg-[var(--chair)]",
              table.shape === "bar" ? "rounded-full" : "rounded-[7px]",
              inactive && "border-dashed",
            )}
            style={{ left: chair.left, top: chair.top }}
          />
        ))}
        <span
          className={cn(
            "absolute inset-0 border-[1.5px] border-line-strong bg-surface",
            TOP_RADIUS[table.shape ?? "square"],
            inactive && "border-dashed bg-surface-2",
            "group-focus-visible:outline-dashed group-focus-visible:outline-[3px] group-focus-visible:outline-offset-[10px] group-focus-visible:outline-focus",
          )}
          style={{ boxShadow: shadow || undefined }}
        />
      </span>
      <span className={cn("relative z-10 font-semibold leading-none tracking-tight tabular-nums text-[clamp(15px,3.4cqi,30px)]", inactive && "text-muted-fg")}>
        {table.number}
      </span>
      {inactive && (
        <span
          className={cn(
            "absolute left-1/2 top-full z-20 -translate-x-1/2 whitespace-nowrap rounded-pill border border-status-reserved-line bg-status-reserved-bg px-1.5 text-[11px] font-medium text-status-reserved-fg",
            chairs.length > 0 ? "mt-[calc(var(--cs)*1.3+4px)]" : "mt-2",
          )}
        >
          Inactiva
        </span>
      )}
    </button>
  )
}
