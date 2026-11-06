import type { TableStatus } from "@/types"
import { cn } from "@/lib/utils"
import { INACTIVE_LABEL, statusLabel } from "@/lib/floor/layout"
import { INACTIVE_TONE, toneClasses } from "./tones"

/** Status in words on its tint (never colour alone); `inactive` says "Inactiva" on the neutral tint. */
export function StatusChip({ status, inactive, className }: { status: TableStatus; inactive?: boolean; className?: string }) {
  const tone = inactive ? INACTIVE_TONE : toneClasses(status)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-medium leading-5",
        tone.fill,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
      {inactive ? INACTIVE_LABEL : statusLabel(status)}
    </span>
  )
}
