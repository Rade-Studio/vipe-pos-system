"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { Maximize2, Minus, Plus } from "lucide-react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import { INACTIVE_LABEL, TABLE_STATUS, isPlaced, type FloorZone } from "@/lib/floor/layout"
import type { TableAlert } from "@/lib/floor/alerts"
import { FloorMap } from "./FloorMap"
import { INACTIVE_TONE, toneClasses } from "./tones"
import { UnplacedStrip } from "./UnplacedStrip"

export interface FloorPlanProps {
  zones: FloorZone[]
  tables: Table[]
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  currentWaiterId?: string
  waiterNameOf?: (table: Table) => string | undefined
  /** Time since each table's open order started ("18 min", T22). */
  elapsedOf?: (table: Table) => string | null | undefined
  /** Pending carta requests per table (ux-carta-mesero S4); only the waiter floor passes it. */
  alertOf?: (table: Table) => TableAlert | undefined
  /** Small read-only map (admin overview): no zoom, no "Sin ubicar" strip, number + status icon per table. */
  compact?: boolean
  className?: string
}

/** Floor width as a multiple of the viewport: 1 fits, the rest scroll. */
const ZOOM_STEPS = [1, 1.5, 2, 2.5] as const

/** The legend under the live floor (ux-carta-mesero S5): the colour of every state, in words. */
const LEGEND = [
  ...Object.entries(TABLE_STATUS).map(([status, { label }]) => ({ label, dot: toneClasses(status as keyof typeof TABLE_STATUS).dot })),
  { label: INACTIVE_LABEL, dot: INACTIVE_TONE.dot },
]

const ICON_BUTTON =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-pill bg-surface px-2.5 text-sm font-medium text-fg disabled:opacity-50 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

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
  elapsedOf,
  alertOf,
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

  // T22 minimap: the visible part of a zoomed floor, as fractions of the scroller.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const zoomed = !compact && zoom > 0
  const [view, setView] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el || el.scrollWidth === 0 || el.scrollHeight === 0) return
    setView({
      x: el.scrollLeft / el.scrollWidth,
      y: el.scrollTop / el.scrollHeight,
      w: Math.min(1, el.clientWidth / el.scrollWidth),
      h: Math.min(1, el.clientHeight / el.scrollHeight),
    })
  }, [])
  useEffect(() => {
    if (zoomed) measure()
  }, [zoomed, zoom, zone?.id, measure])
  const jumpTo = (event: MouseEvent<HTMLButtonElement>) => {
    const el = scrollerRef.current
    const rect = event.currentTarget.getBoundingClientRect()
    if (!el || rect.width === 0 || rect.height === 0) return
    const fx = (event.clientX - rect.left) / rect.width
    const fy = (event.clientY - rect.top) / rect.height
    el.scrollTo?.({ left: fx * el.scrollWidth - el.clientWidth / 2, top: fy * el.scrollHeight - el.clientHeight / 2, behavior: "smooth" })
  }

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
        </div>
      )}

      {zone && (
        <div className="relative min-w-0">
        <div
          ref={scrollerRef}
          data-testid="floor-scroller"
          onScroll={zoomed ? measure : undefined}
          className={cn(
            "min-w-0 rounded-card-lg bg-[radial-gradient(120%_80%_at_50%_0%,var(--accent-tint),transparent_60%)]",
            // Unzoomed, the page scrolls: tables on the last row overflow the floor a
            // little, and an own scroller with overscroll-contain caught the wheel.
            zoomed ? "overflow-auto overscroll-contain" : "overflow-x-clip",
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
              elapsedOf={elapsedOf}
              alertOf={alertOf}
              mode={compact ? "mini" : "live"}
            />
          </div>
        </div>
          {!compact && (
          // S6: a floating cluster in the floor's bottom padding, so the zone tabs keep the whole row on a phone.
          <div role="group" aria-label="Zoom del plano" className="absolute bottom-1 left-2 z-10 flex items-center gap-1 rounded-pill border border-line bg-card/90 p-0.5 shadow-sm backdrop-blur lg:hidden">
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
          </div>
        )}
        {zoomed && (
          // Phone/tablet only: from 1024 px the floor fits and has no zoom.
          <button
            type="button"
            aria-label={`Minimapa de ${zone.name}: toca para ir a esa parte del plano`}
            onClick={jumpTo}
            className="absolute bottom-2 right-2 z-10 w-28 overflow-hidden rounded-xl border border-line-strong bg-card/95 shadow-md focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus lg:hidden"
            style={{ aspectRatio: String(zone.aspect) }}
          >
            {zoneTables.map((table) => (
              <span
                key={table.id}
                data-testid="minimap-table"
                aria-hidden
                className={cn(
                  "absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border",
                  table.isActive === false ? "border-line-strong bg-surface-2" : toneClasses(table.status).fill,
                )}
                style={{ left: `${(table.x ?? 0.5) * 100}%`, top: `${(table.y ?? 0.5) * 100}%` }}
              />
            ))}
            <span
              data-testid="minimap-view"
              aria-hidden
              className="absolute rounded-[4px] border-2 border-brand bg-transparent"
              style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }}
            />
          </button>
        )}
        </div>
      )}

      {!compact && zone && (
        <ul aria-label="Estados de las mesas" className="-mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-xs text-muted-fg">
          {LEGEND.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.dot)} />
              {item.label}
            </li>
          ))}
        </ul>
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
