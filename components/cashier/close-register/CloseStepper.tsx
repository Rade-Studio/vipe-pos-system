"use client"

import { useRef, type KeyboardEvent } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { focusRing } from "@/components/cashier/cashier-ui"

export type CloseStep = { title: string; status: string; done: boolean }

export const closeStepTabId = (index: number) => `close-step-tab-${index}`
export const CLOSE_STEP_PANEL_ID = "close-step-panel"

/**
 * The close wizard's stepper (caja-cierres S3, design 05): a tablist whose
 * steps are reachable by click and by the arrow keys (Home/End too); the
 * active step is the only one in the tab order.
 */
export function CloseStepper({
  steps,
  active,
  onSelect,
}: {
  steps: readonly CloseStep[]
  active: number
  onSelect: (index: number) => void
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = steps.length - 1
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? index === last ? 0 : index + 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? index === 0 ? last : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    onSelect(next)
    tabs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label="Pasos del cierre" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((step, index) => {
        const selected = index === active
        return (
          <button
            key={step.title}
            ref={(node) => {
              tabs.current[index] = node
            }}
            type="button"
            role="tab"
            id={closeStepTabId(index)}
            aria-label={step.title}
            aria-selected={selected}
            aria-controls={CLOSE_STEP_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              "flex min-h-[44px] min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left",
              selected ? "border-brand bg-brand-tint" : "border-line bg-surface hover:bg-surface-2",
              focusRing,
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                step.done ? "bg-status-ok-bg text-status-ok-fg" : selected ? "bg-brand text-brand-contrast" : "bg-surface-2 text-muted-fg",
              )}
            >
              {step.done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">{step.title}</span>
              <span className="block truncate text-xs text-muted-fg">{step.status}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
