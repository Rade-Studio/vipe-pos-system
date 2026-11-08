"use client"

import { useId } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { isInactive } from "@/lib/floor/layout"
import { reservationLine } from "@/lib/tables/reservation"
import { StatusChip } from "./StatusChip"

interface UnplacedStripProps {
  tables: Table[]
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  waiterNameOf?: (table: Table) => string | undefined
}

/** Tables without a zone or coordinates: still one tap away. */
export function UnplacedStrip({ tables, selectedTableId, onSelectTable, waiterNameOf }: UnplacedStripProps) {
  const headingId = useId()
  if (tables.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-fg">
        Sin ubicar
      </h3>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {tables.map((table) => {
          const waiterName = waiterNameOf?.(table)
          const reservation = reservationLine(table)
          return (
            <button
              key={table.id}
              type="button"
              aria-pressed={selectedTableId === table.id}
              onClick={() => onSelectTable(table.id)}
              className={cn(
                "flex min-h-[44px] shrink-0 flex-col items-start justify-center gap-1 rounded-card border border-line bg-surface px-3 py-2 text-left text-sm text-fg",
                "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus",
                selectedTableId === table.id && "border-brand ring-2 ring-brand",
                isInactive(table) && "border-dashed bg-surface-2 text-muted-fg",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="font-semibold">Mesa {table.number}</span>
                <StatusChip status={table.status} inactive={isInactive(table)} />
              </span>
              {waiterName && <span className="max-w-[12rem] truncate text-xs text-muted-fg">{waiterName}</span>}
              {reservation && <span className="max-w-[12rem] truncate text-xs font-medium text-fg">{reservation}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}
