import type React from "react"
import { cn } from "@/lib/utils"

/** Status tones of `design/system.md` (status.* tokens). */
export type ChipTone = "free" | "occupied" | "kitchen" | "served" | "reserved" | "danger" | "warning" | "ok"

const TONE: Record<ChipTone, string> = {
  free: "bg-status-free-bg text-status-free-fg border-status-free-line",
  occupied: "bg-status-occupied-bg text-status-occupied-fg border-status-occupied-line",
  kitchen: "bg-status-kitchen-bg text-status-kitchen-fg border-status-kitchen-line",
  served: "bg-status-served-bg text-status-served-fg border-status-served-line",
  reserved: "bg-status-reserved-bg text-status-reserved-fg border-status-reserved-line",
  danger: "bg-status-danger-bg text-status-danger-fg border-status-danger-line",
  warning: "bg-status-warning-bg text-status-warning-fg border-status-warning-line",
  ok: "bg-status-ok-bg text-status-ok-fg border-status-ok-line",
}

export function toneClasses(tone: ChipTone): string {
  return TONE[tone]
}

/** A status pill that never wraps or clips: it keeps its own width. */
export function Chip({
  tone,
  dot = false,
  className,
  children,
}: {
  tone: ChipTone
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-semibold leading-5",
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

/** Money: tabular figures, never wraps. */
export function Money({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("whitespace-nowrap tabular-nums", className)}>{children}</span>
}

/** Small uppercase label above a heading. */
export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("truncate text-xs font-semibold uppercase tracking-wide text-muted-fg", className)}>{children}</p>
  )
}

/** Focus ring shared by the cashier's custom buttons: distinct from the selected state. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
