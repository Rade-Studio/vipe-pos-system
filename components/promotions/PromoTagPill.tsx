import type { PromoTag, PromoTagTone } from "@/lib/promotions/waiter"
import { cn } from "@/lib/utils"

const TONES: Record<PromoTagTone, string> = {
  on: "bg-brand text-brand-contrast font-semibold",
  ending: "bg-status-warning-fg text-status-warning-bg font-semibold",
  later: "border border-line-strong bg-card text-fg-2 font-medium",
}

/** "2x1 · hasta 19:00" (on), yellow when it ends in ≤ 10 min, "2x1 desde 17:00" (later). */
export function PromoTagPill({ tag, className }: { tag: Pick<PromoTag, "text" | "tone">; className?: string }) {
  return (
    <span className={cn("inline-flex h-[26px] flex-none items-center whitespace-nowrap rounded-full px-2.5 text-[12.5px]", TONES[tag.tone], className)}>
      {tag.text}
    </span>
  )
}
