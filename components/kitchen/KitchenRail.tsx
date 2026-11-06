"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RailTicket {
  key: string
  /** "Mesa 7 · Atrasada · 27 min": the phone counter's subtitle. */
  summary: string
  node: ReactNode
}

interface Visible {
  first: number
  last: number
}

const iconButton =
  "grid h-11 w-11 flex-none place-items-center rounded-full border border-line-strong bg-surface-2 text-fg focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus disabled:opacity-40"

/** Text of the rail counter for the tickets in view. */
export function railCounter(visible: Visible, total: number): string {
  if (visible.first === visible.last) return `${visible.first + 1} de ${total}`
  const more = total - 1 - visible.last
  return `Viendo ${visible.first + 1}–${visible.last + 1} de ${total}${more > 0 ? ` · ${more} más →` : ""}`
}

/**
 * Horizontal rail of kitchen tickets, oldest first: one ticket per screen with
 * snap on a phone, two or three on a tablet, fixed-width tickets with a fade
 * on the desktop. Prev/next move one ticket.
 */
export function KitchenRail({ tickets }: { tickets: RailTicket[] }) {
  const railRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState<Visible>({ first: 0, last: Math.max(0, tickets.length - 1) })
  const [atEnd, setAtEnd] = useState(true)

  const measure = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    // The visible area is the rail minus its inline padding.
    const box = rail.getBoundingClientRect()
    const style = getComputedStyle(rail)
    const left = box.left + (parseFloat(style.paddingLeft) || 0)
    const right = box.right - (parseFloat(style.paddingRight) || 0)
    let first = -1
    let last = -1
    Array.from(rail.children).forEach((child, index) => {
      const rect = child.getBoundingClientRect()
      if (rect.left >= left - 2 && rect.right <= right + 2) {
        if (first < 0) first = index
        last = index
      }
    })
    if (first < 0) first = last = 0
    setVisible((previous) => (previous.first === first && previous.last === last ? previous : { first, last }))
    setAtEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4)
  }, [])

  useEffect(() => {
    measure()
    const rail = railRef.current
    if (!rail || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measure())
    observer.observe(rail)
    return () => observer.disconnect()
  }, [measure, tickets.length])

  const go = (direction: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    const children = rail.children as HTMLCollectionOf<HTMLElement>
    const step = children.length > 1 ? children[1].offsetLeft - children[0].offsetLeft : rail.clientWidth
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    rail.scrollBy?.({ left: direction * step, behavior: reduce ? "auto" : "smooth" })
  }

  const total = tickets.length
  const last = Math.min(visible.last, total - 1)
  const first = Math.min(visible.first, last)
  const counter = railCounter({ first, last }, total)
  const single = first === last ? tickets[first]?.summary : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 md:justify-end md:px-6">
        <button type="button" className={cn(iconButton, "md:order-2")} aria-label="Comanda anterior" disabled={first === 0} onClick={() => go(-1)}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 md:flex-none md:items-end" aria-live="polite">
          <span className="whitespace-nowrap text-base font-semibold tabular-nums">{counter}</span>
          {single && <span className="max-w-full truncate text-[13px] text-muted-fg md:hidden">{single}</span>}
        </div>
        <button
          type="button"
          className={cn(iconButton, "md:order-3")}
          aria-label="Comanda siguiente"
          disabled={last >= total - 1}
          onClick={() => go(1)}
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div
        ref={railRef}
        tabIndex={0}
        aria-label="Riel de comandas"
        onScroll={() => requestAnimationFrame(measure)}
        className={cn(
          "grid min-h-0 flex-1 snap-x snap-mandatory auto-cols-[100%] grid-flow-col gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-4 px-4 pb-4 pt-1 [scrollbar-width:thin] focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-focus",
          "md:auto-cols-[calc((100%-16px)/2)] md:gap-4 md:scroll-px-6 md:px-6 md:pb-6",
          "lg:auto-cols-[calc((100%-32px)/3)]",
          "min-[1400px]:auto-cols-[340px]",
          !atEnd && "min-[1400px]:[mask-image:linear-gradient(90deg,#000_calc(100%-72px),transparent)]",
        )}
      >
        {tickets.map((ticket) => (
          <div key={ticket.key} className="min-h-0 min-w-0 snap-start">
            {ticket.node}
          </div>
        ))}
      </div>
    </div>
  )
}
