"use client"

import { cn } from "@/lib/utils"
import { FOCUS } from "./styles"

/** The artboard's `.stepper`: − N + with 44 px targets (L8: a stepper, never a list). */
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  min,
  max,
}: {
  value: number
  onDecrement: () => void
  onIncrement: () => void
  decrementLabel: string
  incrementLabel: string
  /** Disables − at this value (absent: − always works, e.g. removing a line). */
  min?: number
  max?: number
}) {
  return (
    <span className="inline-flex flex-none items-center rounded-pill border border-line-strong">
      <button
        type="button"
        aria-label={decrementLabel}
        disabled={min !== undefined && value <= min}
        onClick={onDecrement}
        className={cn("h-11 w-11 rounded-full text-lg disabled:opacity-40", FOCUS)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span aria-live="polite" className="min-w-[22px] text-center font-semibold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label={incrementLabel}
        disabled={max !== undefined && value >= max}
        onClick={onIncrement}
        className={cn("h-11 w-11 rounded-full text-lg disabled:opacity-40", FOCUS)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </span>
  )
}
