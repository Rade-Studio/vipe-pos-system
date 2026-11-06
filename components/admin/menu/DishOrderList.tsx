"use client"

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react"
import type { DishDto } from "@/lib/api/catalog"
import { moveItem } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"

/** Gap between dish rows (`gap-0.5`), part of one drag step. */
const ROW_GAP = 2

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

interface DishOrderListProps {
  label: string
  dishes: DishDto[]
  className?: string
  /** A save is in flight: moves wait. */
  saving: boolean
  /** Saves `ids` as the group order (optimistic, rolled back by the caller on a refusal). */
  onReorder: (ids: string[], movedId: string) => void
}

/**
 * The dishes of one group (a subcategory, or a category's dishes outside any)
 * in waiter order (T27): drag the handle or ↑/↓ on it from tablet up, Subir /
 * Bajar on the phone, as the category rows.
 */
export function DishOrderList({ label, dishes, className, saving, onReorder }: DishOrderListProps) {
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<{ id: string; control: "handle" | "up" | "down" } | null>(null)
  const controls = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<{ id: string; startY: number; step: number; ids: string[] } | null>(null)

  const byId = new Map(dishes.map((dish) => [dish.id, dish]))
  const shown = dragOrder ? dragOrder.map((id) => byId.get(id)).filter((dish): dish is DishDto => Boolean(dish)) : dishes
  const movable = dishes.length > 1

  useEffect(() => {
    if (!focusId) return
    const get = (control: string) => controls.current.get(`${control}:${focusId.id}`)
    const target = get(focusId.control)
    // Subir at the top (or Bajar at the bottom) turns off: keep the focus on its pair.
    const pair = focusId.control === "up" ? get("down") : focusId.control === "down" ? get("up") : undefined
    ;(target?.disabled && pair ? pair : target)?.focus()
    setFocusId(null)
  }, [focusId, dishes])

  const move = (id: string, delta: number, control: "handle" | "up" | "down") => {
    if (saving) return
    const ids = dishes.map((dish) => dish.id)
    const from = ids.indexOf(id)
    const next = moveItem(ids, from, from + delta)
    if (!next) return
    setFocusId({ id, control })
    onReorder(next, id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    move(id, event.key === "ArrowUp" ? -1 : 1, "handle")
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (saving || event.button !== 0) return
    const row = event.currentTarget.closest("li")
    if (!row) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const ids = dishes.map((dish) => dish.id)
    drag.current = { id, startY: event.clientY, step: row.getBoundingClientRect().height + ROW_GAP, ids }
    setDraggingId(id)
    setDragOrder(ids)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state || state.step <= 0) return
    const steps = Math.round((event.clientY - state.startY) / state.step)
    if (!steps) return
    const from = state.ids.indexOf(state.id)
    const to = Math.max(0, Math.min(state.ids.length - 1, from + steps))
    const next = moveItem(state.ids, from, to)
    if (!next) return
    drag.current = { ...state, ids: next, startY: state.startY + (to - from) * state.step }
    setDragOrder(next)
  }
  const onPointerUp = () => {
    const state = drag.current
    drag.current = null
    setDraggingId(null)
    setDragOrder(null)
    if (!state) return
    if (state.ids.join() !== dishes.map((dish) => dish.id).join()) {
      setFocusId({ id: state.id, control: "handle" })
      onReorder(state.ids, state.id)
    }
  }

  const ref = (key: string) => (element: HTMLButtonElement | null) => {
    if (element) controls.current.set(key, element)
    else controls.current.delete(key)
  }
  const iconButton = cn("grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-fg-2 disabled:opacity-40 md:hidden", focusRing)

  return (
    <ol aria-label={label} className={cn("grid gap-0.5", className)}>
      {shown.map((dish, index) => (
        <li
          key={dish.id}
          className={cn(
            "flex min-h-11 min-w-0 items-center gap-1 rounded-lg pl-2 text-sm text-fg-2",
            movable && "md:pl-0",
            draggingId === dish.id && "relative z-10 bg-card shadow-[0_12px_24px_-12px_rgba(0,0,0,.5),0_0_0_2px_var(--accent)]",
          )}
        >
          {movable && (
            <button
              type="button"
              ref={ref(`handle:${dish.id}`)}
              aria-label={`Mover ${dish.name}, posición ${index + 1} de ${shown.length}`}
              aria-roledescription="asa para reordenar"
              aria-describedby="menu-tree-dish-handle-help"
              onKeyDown={(event) => onKeyDown(event, dish.id)}
              onPointerDown={(event) => onPointerDown(event, dish.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={cn(
                "hidden h-9 w-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted-fg active:cursor-grabbing md:grid",
                focusRing,
              )}
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          )}
          <span data-dish-name className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
            {dish.name}
            {!dish.active && <span className="text-muted-fg"> · Inactivo</span>}
          </span>
          {movable && (
            <>
              <button
                type="button"
                ref={ref(`up:${dish.id}`)}
                aria-label={`Subir ${dish.name}`}
                disabled={saving || index === 0}
                onClick={() => move(dish.id, -1, "up")}
                className={iconButton}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                ref={ref(`down:${dish.id}`)}
                aria-label={`Bajar ${dish.name}`}
                disabled={saving || index === shown.length - 1}
                onClick={() => move(dish.id, 1, "down")}
                className={iconButton}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
        </li>
      ))}
    </ol>
  )
}
