import * as LucideIcons from "lucide-react"
import { UtensilsCrossed, type LucideIcon } from "lucide-react"
import type { CategoryColor } from "@/lib/api/catalog"
import { cn } from "@/lib/utils"

/**
 * Category colours on the status tokens of design/system.md (the menu tree
 * artboard maps them the same way). Literal class names, so Tailwind sees them.
 */
const COLOR_CLASSES: Record<CategoryColor, { fill: string; bar: string; swatch: string }> = {
  neutral: {
    fill: "bg-status-reserved-bg border-status-reserved-line text-status-reserved-fg",
    bar: "bg-status-reserved-fg",
    swatch: "bg-status-reserved-bg border-status-reserved-fg text-status-reserved-fg",
  },
  yellow: {
    fill: "bg-status-warning-bg border-status-warning-line text-status-warning-fg",
    bar: "bg-status-warning-fg",
    swatch: "bg-status-warning-bg border-status-warning-fg text-status-warning-fg",
  },
  orange: {
    fill: "bg-status-kitchen-bg border-status-kitchen-line text-status-kitchen-fg",
    bar: "bg-status-kitchen-fg",
    swatch: "bg-status-kitchen-bg border-status-kitchen-fg text-status-kitchen-fg",
  },
  sky: {
    fill: "bg-status-served-bg border-status-served-line text-status-served-fg",
    bar: "bg-status-served-fg",
    swatch: "bg-status-served-bg border-status-served-fg text-status-served-fg",
  },
  violet: {
    fill: "bg-status-occupied-bg border-status-occupied-line text-status-occupied-fg",
    bar: "bg-status-occupied-fg",
    swatch: "bg-status-occupied-bg border-status-occupied-fg text-status-occupied-fg",
  },
  emerald: {
    fill: "bg-status-free-bg border-status-free-line text-status-free-fg",
    bar: "bg-status-free-fg",
    swatch: "bg-status-free-bg border-status-free-fg text-status-free-fg",
  },
  rose: {
    fill: "bg-status-danger-bg border-status-danger-line text-status-danger-fg",
    bar: "bg-status-danger-fg",
    swatch: "bg-status-danger-bg border-status-danger-fg text-status-danger-fg",
  },
}

export const colorClasses = (color: CategoryColor | undefined) => COLOR_CLASSES[color ?? "neutral"] ?? COLOR_CLASSES.neutral

const ICONS = LucideIcons as unknown as Record<string, LucideIcon | undefined>

/**
 * The Lucide icon for a stored name: the editor stores the component name
 * ("IceCream"), older rows and the dev seed a lowercase/kebab one ("ice-cream").
 */
export function lucideIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null
  const pascal = name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
  return ICONS[name] ?? ICONS[pascal] ?? null
}

/** The category icon; a generic one when the name is unknown. */
export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = lucideIcon(name) ?? UtensilsCrossed
  return <Icon className={cn("h-5 w-5", className)} aria-hidden />
}

/** The coloured square with the category icon (tree rows, preview tiles). */
export function CategorySwatch({ color, icon, className }: { color: CategoryColor; icon: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border-[1.5px]", colorClasses(color).fill, className)}
    >
      <CategoryIcon name={icon} className="h-[18px] w-[18px]" />
    </span>
  )
}
