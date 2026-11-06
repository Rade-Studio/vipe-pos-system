import type { TableStatus } from "@/types"
import { cn } from "@/lib/utils"
import { statusLabel } from "@/lib/floor/layout"
import { toneClasses } from "./tones"

/** Status in words on its tint (never colour alone). */
export function StatusChip({ status, className }: { status: TableStatus; className?: string }) {
  const tone = toneClasses(status)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-medium leading-5",
        tone.fill,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      {statusLabel(status)}
    </span>
  )
}
