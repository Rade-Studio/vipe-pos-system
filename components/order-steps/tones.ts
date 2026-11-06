import type { CategoryColor } from "@/lib/api/catalog"

/**
 * Tile classes per category colour (design/flujo-mesero `.c-*`): the closed
 * colour set reuses the status families of design/system.md. They live under
 * `components/` so the Tailwind content scan sees the literal class names.
 */
const CATEGORY_TONES: Record<CategoryColor, { tile: string; bar: string; icon: string }> = {
  neutral: { tile: "bg-status-reserved-bg border-status-reserved-line", bar: "bg-status-reserved-fg", icon: "text-status-reserved-fg" },
  yellow: { tile: "bg-status-warning-bg border-status-warning-line", bar: "bg-status-warning-fg", icon: "text-status-warning-fg" },
  orange: { tile: "bg-status-kitchen-bg border-status-kitchen-line", bar: "bg-status-kitchen-fg", icon: "text-status-kitchen-fg" },
  sky: { tile: "bg-status-served-bg border-status-served-line", bar: "bg-status-served-fg", icon: "text-status-served-fg" },
  violet: { tile: "bg-status-occupied-bg border-status-occupied-line", bar: "bg-status-occupied-fg", icon: "text-status-occupied-fg" },
  emerald: { tile: "bg-status-free-bg border-status-free-line", bar: "bg-status-free-fg", icon: "text-status-free-fg" },
  rose: { tile: "bg-status-danger-bg border-status-danger-line", bar: "bg-status-danger-fg", icon: "text-status-danger-fg" },
}

export const categoryTone = (color: CategoryColor | undefined) => CATEGORY_TONES[color ?? "neutral"] ?? CATEGORY_TONES.neutral
