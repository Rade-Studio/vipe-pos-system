"use client"

import * as React from "react"

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"

// Collapsed deck: each older toast peeks this far above the one in front of it.
const STACK_OFFSET_PX = 8
const STACK_SCALE_STEP = 0.05
// Viewport padding (p-4) and the gap kept above a control the deck rises over.
const VIEWPORT_PADDING_PX = 16
const CLEARANCE_PX = 8
const MIN_DECK_HEIGHT_PX = 64
const ACTIONABLE = "button, a[href], input, select, textarea, [role=button], [role=tab]"

// A control of a bottom bar stays put: it sits in a fixed/sticky container, or
// nothing around it scrolls. Content that scrolls away under the deck does not count.
function staysPut(control: Element): boolean {
  for (let el: Element | null = control; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (style.position === "fixed" || style.position === "sticky") return true
    if (/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return false
  }
  return document.documentElement.scrollHeight <= window.innerHeight
}

// How far the collapsed deck must rise so it covers no control of a bottom bar
// ("Enviar a cocina", "Cobrar"): samples the page under its footprint and moves
// above the highest control found, at most to half the screen.
function liftAboveControls(viewport: HTMLElement): number {
  if (typeof document.elementsFromPoint !== "function") return 0
  const items = [...viewport.querySelectorAll("li")].map((li) => li.getBoundingClientRect())
  const left = Math.min(...items.map((r) => r.left), viewport.getBoundingClientRect().left + VIEWPORT_PADDING_PX)
  const right = Math.max(...items.map((r) => r.right), viewport.getBoundingClientRect().right - VIEWPORT_PADDING_PX)
  const height = Math.max(MIN_DECK_HEIGHT_PX, ...items.map((r) => r.height + STACK_OFFSET_PX * 2))
  const vh = window.innerHeight
  let lift = 0
  for (let round = 0; round < 4 && lift < vh / 2; round++) {
    let top = Infinity
    const bottom = vh - VIEWPORT_PADDING_PX - lift
    for (let y = bottom - 2; y > bottom - height; y -= 12)
      for (let i = 0; i <= 4; i++) {
        const hit = document.elementsFromPoint(left + ((right - left) * i) / 4, y).find((el) => !viewport.contains(el))
        const control = hit?.closest(ACTIONABLE)
        if (control && staysPut(control)) top = Math.min(top, control.getBoundingClientRect().top)
      }
    if (top === Infinity) break
    lift = Math.min(Math.round(vh / 2), Math.max(lift, vh - top - CLEARANCE_PX))
  }
  return lift
}

export function Toaster() {
  const { toasts } = useToast()
  const [expanded, setExpanded] = React.useState(false)
  const viewportRef = React.useRef<HTMLOListElement>(null)

  const openIds = toasts.filter((t) => t.open !== false).map((t) => t.id)
  const hasOpen = openIds.length > 0
  const [lift, setLift] = React.useState(0)

  // Re-measure while toasts show: bars appear and change (the cart fills, a sheet opens).
  React.useLayoutEffect(() => {
    if (!hasOpen || expanded || !viewportRef.current) return
    const measure = () => viewportRef.current && setLift(liftAboveControls(viewportRef.current))
    measure()
    const timer = setInterval(measure, 1000)
    window.addEventListener("resize", measure)
    return () => {
      clearInterval(timer)
      window.removeEventListener("resize", measure)
    }
  }, [hasOpen, expanded, openIds.length])

  React.useEffect(() => {
    if (!hasOpen) setExpanded(false)
  }, [hasOpen])

  // Toasts are portalled into the viewport, so React hover/focus/pointer events from
  // them never reach it: listen on the DOM node instead.
  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const expand = () => setExpanded(true)
    const collapseOnLeave = (event: FocusEvent) => {
      if (!viewport.contains(event.relatedTarget as Node | null)) setExpanded(false)
    }
    const collapse = () => setExpanded(false)
    viewport.addEventListener("mouseenter", expand)
    viewport.addEventListener("mouseleave", collapse)
    viewport.addEventListener("focusin", expand)
    viewport.addEventListener("focusout", collapseOnLeave)
    viewport.addEventListener("pointerdown", expand)
    return () => {
      viewport.removeEventListener("mouseenter", expand)
      viewport.removeEventListener("mouseleave", collapse)
      viewport.removeEventListener("focusin", expand)
      viewport.removeEventListener("focusout", collapseOnLeave)
      viewport.removeEventListener("pointerdown", expand)
    }
  }, [])

  // A tap expands the deck; a tap anywhere else collapses it (touch has no hover).
  React.useEffect(() => {
    if (!expanded) return
    const collapseOutside = (event: PointerEvent) => {
      if (!viewportRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener("pointerdown", collapseOutside)
    return () => document.removeEventListener("pointerdown", collapseOutside)
  }, [expanded])

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, style, ...props }) => {
        const index = Math.max(openIds.indexOf(id), 0)
        const stacked = !expanded && index > 0
        return (
          <Toast
            key={id}
            data-stack-index={index}
            data-behind={stacked}
            style={
              {
                ...style,
                zIndex: toasts.length - index,
                "--stack-y": stacked ? `-${index * STACK_OFFSET_PX}px` : "0px",
                "--stack-scale": stacked ? String(1 - index * STACK_SCALE_STEP) : "1",
              } as React.CSSProperties
            }
            {...props}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      {/* Bottom centre as a deck of at most three (L24): only the newest is fully visible. */}
      <ToastViewport
        ref={viewportRef}
        data-expanded={expanded}
        style={{ bottom: lift }}
        className="sm:max-w-[420px]"
      />
    </ToastProvider>
  )
}
