"use client"

import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

/** orders.guests is 1..99 (T17). */
export const MAX_GUESTS = 99

const STEP_BUTTON =
  "grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-card text-fg disabled:cursor-not-allowed disabled:border-line disabled:text-muted-fg " +
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

interface GuestsStepperProps {
  /** Absent: not captured yet ("—"); the first + sets 1. */
  value: number | null | undefined
  onChange: (guests: number) => void
  disabled?: boolean
  className?: string
}

/** − n + for the guests at the table (T22): the waiter flow's new-order question and the table panel. */
export function GuestsStepper({ value, onChange, disabled, className }: GuestsStepperProps) {
  const current = typeof value === "number" ? value : null
  return (
    <span role="group" aria-label="Personas en la mesa" className={cn("inline-flex flex-none items-center gap-1", className)}>
      <button
        type="button"
        aria-label="Quitar una persona"
        disabled={disabled || current === null || current <= 1}
        onClick={() => current !== null && onChange(current - 1)}
        className={STEP_BUTTON}
      >
        <Minus className="h-[18px] w-[18px]" aria-hidden />
      </button>
      <output aria-live="polite" className="min-w-10 text-center text-lg font-semibold tabular-nums">
        {current ?? "—"}
      </output>
      <button
        type="button"
        aria-label="Sumar una persona"
        disabled={disabled || (current ?? 0) >= MAX_GUESTS}
        onClick={() => onChange((current ?? 0) + 1)}
        className={STEP_BUTTON}
      >
        <Plus className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </span>
  )
}
