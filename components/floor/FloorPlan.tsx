"use client"

import { useEffect, useMemo, useState } from "react"
import { Maximize2, Minus, Plus } from "lucide-react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { isPlaced, type FloorZone } from "@/lib/floor/layout"
import { FloorMap } from "./FloorMap"
import { UnplacedStrip } from "./UnplacedStrip"

export interface FloorPlanProps {
  zones: FloorZone[]
  tables: Table[]
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  currentWaiterId?: string
  waiterNameOf?: (table: Table) => string | undefined
  /** Small read-only map (admin overview): no zoom, no "Sin ubicar" strip, number + status icon per table. */
  compact?: boolean
  className?: string
}

/** Floor width as a multiple of the viewport: 1 fits, the rest scroll. */
const ZOOM_STEPS = [1, 1.5, 2, 2.5] as const

const ICON_BUTTON =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill border border-line bg-surface px-3 text-sm font-medium text-fg disabled:opacity-50 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

/**
 * Zone tabs + the zone's floor (zoomable) + the "Sin ubicar" strip: the floor
 * map as the waiter and the kitchen's "Mesas" tab use it.
 */
export function FloorPlan({
  zones,
  tables,
  selectedTableId,
  onSelectTable,
  currentWaiterId,
  waiterNameOf,
  compact = false,
  className,
}: FloorPlanProps) {
  const zoneIds = useMemo(() => new Set(zones.map((zone) => zone.id)), [zones])
  const sorted = useMemo(() => [...tables].sort((a, b) => a.number - b.number), [tables])
  const placed = sorted.filter((table) => isPlaced(table, zoneIds))
  const unplaced = sorted.filter((table) => !isPlaced(table, zoneIds))

  const [zoneId, setZoneId] = useState<string | null>(zones[0]?.id ?? null)
  const [zoom, setZoom] = useState(0)
  const zone = zones.find((candidate) => candidate.id === zoneId) ?? zones[0]

  // A selection made elsewhere (or a zone that disappeared) shows its zone.
  const selectedZoneId = placed.find((table) => table.id === selectedTableId)?.zoneId
  useEffect(() => {
    if (selectedZoneId) setZoneId(selectedZoneId)
  }, [selectedZoneId])

  const zoneTables = zone ? placed.filter((table) => table.zoneId === zone.id) : []

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {zones.length > 0 && zone && (
        <div className="flex min-w-0 items-center gap-2">
          <div
            role="tablist"
            aria-label="Zonas"
            className="flex min-w-0 flex-1 snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [mask-image:linear-gradient(90deg,#000_calc(100%-24px),transparent)]"
          >
            {zones.map((candidate) => {
              const count = placed.filter((table) => table.zoneId === candidate.id).length
              const active = candidate.id === zone.id
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setZoneId(candidate.id)}
                  className={cn(
                    "inline-flex min-h-[44px] shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-pill border px-4 text-sm font-medium last:mr-6",
                    "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus",
                    active ? "border-brand-line bg-brand-tint text-fg" : "border-line bg-surface-2 text-fg-2",
                  )}
                >
                  {candidate.name}
                  <span className="text-xs tabular-nums text-muted-fg">
                    {count}
                    <span className="sr-only"> mesas</span>
                  </span>
                </button>
              )
            })}
          </div>
          {!compact && <div className="flex shrink-0 items-center gap-1 lg:hidden">
            <button
              type="button"
              aria-label="Alejar"
              className={ICON_BUTTON}
              disabled={zoom === 0}
              onClick={() => setZoom((step) => Math.max(0, step - 1))}
            >
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Acercar"
              className={ICON_BUTTON}
              disabled={zoom === ZOOM_STEPS.length - 1}
              onClick={() => setZoom((step) => Math.min(ZOOM_STEPS.length - 1, step + 1))}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Ajustar"
              className={ICON_BUTTON}
              disabled={zoom === 0}
              onClick={() => setZoom(0)}
            >
              <Maximize2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Ajustar</span>
            </button>
          </div>}
        </div>
      )}

      {zone && (
        <div
          className={cn(
            "min-w-0 overflow-auto overscroll-contain rounded-card-lg bg-[radial-gradient(120%_80%_at_50%_0%,var(--accent-tint),transparent_60%)]",
            compact ? "px-2 pb-6 pt-2" : "px-3 pb-12 pt-4 sm:px-6",
          )}
        >
          <div data-testid="floor-zoom" className={cn("mx-auto", zoom === 0 && "max-w-[960px]")} style={{ width: `${ZOOM_STEPS[compact ? 0 : zoom] * 100}%` }}>
            <FloorMap
              zone={zone}
              tables={zoneTables}
              selectedTableId={selectedTableId}
              onSelectTable={onSelectTable}
              currentWaiterId={currentWaiterId}
              waiterNameOf={waiterNameOf}
              mode={compact ? "mini" : "live"}
            />
          </div>
        </div>
      )}

      {!compact && (
        <UnplacedStrip
          tables={unplaced}
          selectedTableId={selectedTableId}
          onSelectTable={onSelectTable}
          waiterNameOf={waiterNameOf}
        />
      )}

      {tables.length === 0 && <p className="py-8 text-center text-sm text-muted-fg">No hay mesas configuradas.</p>}
    </div>
  )
}
