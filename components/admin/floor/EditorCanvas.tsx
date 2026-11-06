"use client"

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import type { Table } from "@/types"
import { cn } from "@/lib/utils"
import type { FloorZone } from "@/lib/floor/layout"
import { tablesInRect, type Band } from "@/lib/admin/floor/align"
import { groupMove, pressIntent, LONG_PRESS_MS } from "@/lib/admin/floor/drag"
import type { ZoneUnits } from "@/lib/admin/floor/units"
import { FLOOR_TOKENS } from "@/components/floor/tones"
import { EditorTable } from "./EditorTable"

export interface EditorCanvasProps {
  zone: FloorZone & ZoneUnits
  /** The zone's placed tables. */
  tables: Table[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  /** New centres of the dragged tables; `gesture` is one id per drag (one undo step). */
  onMove: (moves: { id: string; x: number; y: number }[], gesture: string) => void
  /** An arrow key on a table (`big` with Shift). */
  onNudge: (tableId: string, key: string, big: boolean) => void
  className?: string
}

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
const MIN_BAND = 0.01

const WALL_POSITION = {
  top: "left-1/2 top-2 -translate-x-1/2",
  bottom: "bottom-2 left-1/2 -translate-x-1/2",
  left: "left-2 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl] rotate-180",
  right: "right-2 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl]",
} as const

interface Press {
  pointerId: number
  pointerType: string
  anchorId: string
  startAt: number
  startPx: { x: number; y: number }
  start: { x: number; y: number }
  group: Table[]
  dragging: boolean
  moved: boolean
  gesture: string
}

let gestureSeq = 0

/**
 * The admin editor's floor (T26): the shared floor look (flat, wall labels,
 * grid) with selection by click, Shift/Cmd/Ctrl click and a rubber band on
 * the empty floor (mouse), dragging the selection together, and on touch a
 * long press to pick a table up so a swipe or pinch still scrolls and zooms.
 */
export function EditorCanvas({ zone, tables, selectedIds, onSelect, onMove, onNudge, className }: EditorCanvasProps) {
  const floorRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipClick = useRef<string | null>(null)
  const [band, setBand] = useState<(Band & { pointerId: number; additive: boolean }) | null>(null)
  const [lifted, setLifted] = useState<string | null>(null)

  // A picked-up touch must not scroll the page: block the touchmove while dragging.
  useEffect(() => {
    const floor = floorRef.current
    if (!floor) return
    const block = (event: TouchEvent) => {
      if (press.current?.dragging && event.cancelable) event.preventDefault()
    }
    floor.addEventListener("touchmove", block, { passive: false })
    return () => floor.removeEventListener("touchmove", block)
  }, [])

  useEffect(() => () => clearTimer(), [])

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const fraction = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const rect = floorRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
  }

  const beginDrag = (current: Press, target: Element | null) => {
    current.dragging = true
    setLifted(current.anchorId)
    try {
      target?.setPointerCapture?.(current.pointerId)
    } catch {
      // The pointer may be gone already (released during the long press).
    }
    if (current.pointerType === "touch") navigator.vibrate?.(10)
  }

  const tablePointerDown = (tableId: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      skipClick.current = tableId
      onSelect(selectedIds.includes(tableId) ? selectedIds.filter((id) => id !== tableId) : [...selectedIds, tableId])
      return
    }
    const at = fraction(event)
    const table = tables.find((candidate) => candidate.id === tableId)
    if (!at || !table) return
    const inSelection = selectedIds.includes(tableId)
    const group = inSelection ? tables.filter((candidate) => selectedIds.includes(candidate.id)) : [table]
    if (!inSelection) onSelect([tableId])
    gestureSeq += 1
    const current: Press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      anchorId: tableId,
      startAt: Date.now(),
      startPx: { x: event.clientX, y: event.clientY },
      start: at,
      group,
      dragging: false,
      moved: false,
      gesture: `drag:${gestureSeq}`,
    }
    press.current = current
    const target = event.currentTarget
    if (pressIntent(current.pointerType, 0, 0) === "drag") beginDrag(current, target)
    else timer.current = setTimeout(() => press.current === current && beginDrag(current, target), LONG_PRESS_MS)
  }

  const floorPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return
    const at = fraction(event)
    if (!at) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setBand({ x1: at.x, y1: at.y, x2: at.x, y2: at.y, pointerId: event.pointerId, additive: event.shiftKey || event.metaKey || event.ctrlKey })
  }

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (band && event.pointerId === band.pointerId) {
      const at = fraction(event)
      if (at) setBand({ ...band, x2: at.x, y2: at.y })
      return
    }
    const current = press.current
    if (!current || event.pointerId !== current.pointerId) return
    if (!current.dragging) {
      const moved = Math.hypot(event.clientX - current.startPx.x, event.clientY - current.startPx.y)
      if (pressIntent(current.pointerType, Date.now() - current.startAt, moved) === "scroll") {
        clearTimer()
        press.current = null
      }
      return
    }
    const at = fraction(event)
    if (!at) return
    current.moved = true
    onMove(groupMove(current.group, current.anchorId, at.x - current.start.x, at.y - current.start.y, zone), current.gesture)
  }

  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (band && event.pointerId === band.pointerId) {
      const big = Math.abs(band.x2 - band.x1) > MIN_BAND || Math.abs(band.y2 - band.y1) > MIN_BAND
      const ids = big ? tablesInRect(tables, band, zone.aspect) : []
      onSelect(band.additive ? [...new Set([...selectedIds, ...ids])] : ids)
      setBand(null)
      return
    }
    const current = press.current
    if (!current || event.pointerId !== current.pointerId) return
    clearTimer()
    if (current.moved) skipClick.current = current.anchorId
    press.current = null
    setLifted(null)
  }

  const tableClick = (tableId: string) => {
    if (skipClick.current === tableId) {
      skipClick.current = null
      return
    }
    skipClick.current = null
    if (selectedIds.length > 1 && selectedIds.includes(tableId)) return
    onSelect([tableId])
  }

  const keyDown = (tableId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (!ARROW_KEYS.has(event.key)) return
    event.preventDefault()
    onNudge(tableId, event.key, event.shiftKey)
  }

  const bandBox = band && {
    left: `${Math.min(band.x1, band.x2) * 100}%`,
    top: `${Math.min(band.y1, band.y2) * 100}%`,
    width: `${Math.abs(band.x2 - band.x1) * 100}%`,
    height: `${Math.abs(band.y2 - band.y1) * 100}%`,
  }

  return (
    <div className={cn(FLOOR_TOKENS, className)}>
      <div
        ref={floorRef}
        role="group"
        aria-label={`Plano de ${zone.name}, ${tables.length} mesas`}
        onPointerDown={floorPointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onContextMenu={(event) => press.current && event.preventDefault()}
        className={cn("relative w-full touch-manipulation rounded-card-lg border border-[var(--floor-edge)] bg-[var(--floor)]", lifted && "cursor-grabbing")}
        style={
          {
            aspectRatio: String(zone.aspect),
            containerType: "inline-size",
            backgroundImage:
              "linear-gradient(var(--floor-grid) 1px, transparent 1px), linear-gradient(90deg, var(--floor-grid) 1px, transparent 1px)",
            backgroundSize: "5cqi 5cqi",
            boxShadow: "inset 0 2px 12px rgba(0,0,0,.12)",
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
          <EditorTable
            key={table.id}
            table={table}
            aspect={zone.aspect}
            selected={selectedIds.includes(table.id)}
            onClick={tableClick}
            onPointerDown={tablePointerDown}
            onKeyDown={keyDown}
          />
        ))}
        {bandBox && (
          <span
            aria-hidden
            data-testid="selection-band"
            className="pointer-events-none absolute rounded-md border border-dashed border-brand bg-brand-tint/40"
            style={bandBox}
          />
        )}
      </div>
    </div>
  )
}
