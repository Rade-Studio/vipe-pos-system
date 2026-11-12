import type { DishTag } from "@/lib/carta/types"

/**
 * Class fragments shared by the carta components. Focus is a 3 px `--focus`
 * outline, never the brand color, so it stays distinct from selection.
 */
export const FOCUS = "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

export const BRAND_FILL = "bg-[var(--brand)] text-[var(--brand-contrast)]"
export const BRAND_TEXT = "text-[var(--brand-text)]"
export const BRAND_TINT = "border-[var(--brand-line)] bg-[var(--brand-tint)]"

export const TONES = {
  ok: "border-status-ok-line bg-status-ok-bg text-status-ok-fg",
  danger: "border-status-danger-line bg-status-danger-bg text-status-danger-fg",
  served: "border-status-served-line bg-status-served-bg text-status-served-fg",
  reserved: "border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg",
  kitchen: "border-status-kitchen-line bg-status-kitchen-bg text-status-kitchen-fg",
  occupied: "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg",
  warning: "border-status-warning-line bg-status-warning-bg text-status-warning-fg",
} as const

export const TAG_TONES: Record<DishTag, keyof typeof TONES> = {
  vegetarian: "ok",
  spicy: "danger",
  gluten_free: "served",
  dairy: "reserved",
  most_ordered: "kitchen",
}

export const CHIP = "inline-flex min-h-[26px] flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 text-xs font-semibold"
export const TAG = "inline-flex h-[22px] flex-none items-center whitespace-nowrap rounded-pill border px-2 text-[11.5px] font-semibold"
export const GHOST =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-card border border-line-strong bg-transparent px-4 font-semibold"
export const CTA = "min-h-[52px] w-full rounded-card px-4 py-2 text-[15.5px] font-semibold disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-muted-fg"
