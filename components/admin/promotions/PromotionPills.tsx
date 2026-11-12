import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { StateTone } from "./promotion-model"

/** promociones T5 (S9) — the 02 pills on the status tokens of design/system.md. */

const TONES: Record<StateTone | "warn" | "plain", string> = {
  ok: "border-status-ok-line bg-status-ok-bg text-status-ok-fg",
  sched: "border-status-served-line bg-status-served-bg text-status-served-fg",
  paused: "border-status-reserved-line bg-status-reserved-bg text-status-reserved-fg",
  ended: "border-status-reserved-line bg-transparent text-muted-foreground",
  warn: "border-status-warning-line bg-status-warning-bg text-status-warning-fg",
  neutral: "border-border text-foreground/80",
  plain: "border-border text-foreground/80",
}

export function Pill({ tone = "plain", children, ...rest }: { tone?: keyof typeof TONES; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <span
      {...rest}
      className={cn("inline-flex h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium", TONES[tone])}
    >
      {children}
    </span>
  )
}

export function StatePill({ label, tone }: { label: string; tone: StateTone }) {
  return (
    <Pill tone={tone} data-state-pill="">
      {label}
    </Pill>
  )
}
