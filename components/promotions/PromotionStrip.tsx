import { Info } from "lucide-react"

import type { StripState } from "@/lib/promotions/waiter"
import { cn } from "@/lib/utils"

/**
 * The strip over the steps (S11): the promotion applying now with its
 * customer sentence and "quedan N min" / "hasta HH:MM", yellow in its last
 * 10 minutes, or "Sin promociones en este momento". Announced politely.
 */
export function PromotionStrip({ state, className }: { state: StripState; className?: string }) {
  const ending = state.kind === "ending"
  const none = state.kind === "none"
  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state.kind}
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-[14px] border py-2.5 pl-3.5 pr-3",
        none ? "border-line bg-surface" : ending ? "border-status-warning-line bg-status-warning-bg" : "border-brand-line bg-brand-tint",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xs font-bold",
          none ? "bg-surface-2 text-fg-2" : ending ? "bg-status-warning-fg text-status-warning-bg" : "bg-brand text-brand-contrast",
        )}
      >
        {none ? <Info className="h-4 w-4" /> : state.badge}
      </span>
      <span className="min-w-0 flex-1">
        <b className={cn("block truncate text-sm font-semibold", ending && "text-status-warning-fg")}>{state.title}</b>
        {state.text && <span className={cn("block text-[13px] text-fg-2", ending && "text-status-warning-fg")}>{state.text}</span>}
      </span>
      {!none && state.left && (
        <span
          className={cn(
            "flex-none whitespace-nowrap rounded-full border bg-card px-2.5 py-1 font-mono text-[13px] font-semibold tabular-nums",
            ending ? "border-status-warning-line text-status-warning-fg" : "border-brand-line",
          )}
        >
          {state.left}
        </span>
      )}
    </div>
  )
}
