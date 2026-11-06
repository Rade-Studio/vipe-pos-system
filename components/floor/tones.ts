import type { TableStatus } from "@/types"
import { TABLE_STATUS } from "@/lib/floor/layout"

/**
 * Tailwind classes per status family. They live under `components/` so the
 * Tailwind content scan sees the literal class names.
 */
const TONE_CLASSES = {
  free: { fill: "bg-status-free-bg border-status-free-line text-status-free-fg", dot: "bg-status-free-line" },
  reserved: { fill: "bg-status-reserved-bg border-status-reserved-line text-status-reserved-fg", dot: "bg-status-reserved-line" },
  occupied: { fill: "bg-status-occupied-bg border-status-occupied-line text-status-occupied-fg", dot: "bg-status-occupied-line" },
  kitchen: { fill: "bg-status-kitchen-bg border-status-kitchen-line text-status-kitchen-fg", dot: "bg-status-kitchen-line" },
  served: { fill: "bg-status-served-bg border-status-served-line text-status-served-fg", dot: "bg-status-served-line" },
} as const

/** An inactive table (T22): dashed, greyed, never a status colour. */
export const INACTIVE_TONE = { fill: "border-dashed bg-surface-2 border-line-strong text-muted-fg", dot: "bg-line-strong" } as const

export const toneClasses = (status: TableStatus) => TONE_CLASSES[TABLE_STATUS[status]?.tone ?? "reserved"]

/**
 * Floor tokens of design/system.md (light, then dark): floor fill, its grid,
 * edge, tabletop thickness, floor shadow and chair fill. Set on the floor root.
 */
export const FLOOR_TOKENS = [
  "[--floor:#f4f4f5] [--floor-grid:rgba(9,9,11,.06)] [--floor-edge:#e4e4e7]",
  "[--thick:rgba(9,9,11,.18)] [--floor-shadow:rgba(24,24,27,.22)] [--chair:#d4d4d8] [--chair-line:#a1a1aa]",
  "dark:[--floor:#0d0c16] dark:[--floor-grid:rgba(255,255,255,.05)] dark:[--floor-edge:rgba(255,255,255,.08)]",
  "dark:[--thick:rgba(0,0,0,.55)] dark:[--floor-shadow:rgba(0,0,0,.6)] dark:[--chair:#3f3f46] dark:[--chair-line:rgba(255,255,255,.18)]",
].join(" ")
