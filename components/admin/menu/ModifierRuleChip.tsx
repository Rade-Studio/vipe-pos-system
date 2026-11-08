import type { ModifierGroupDto } from "@/lib/api/catalog"
import { modifierRuleText } from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"

/** The rule chip of a modifier group: warm when the waiter cannot skip it. */
export function RuleChip({ group, className }: { group: Pick<ModifierGroupDto, "required" | "minSelect" | "maxSelect">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-pill border px-2 text-xs font-medium",
        group.required ? "border-status-warning-line bg-status-warning-bg text-status-warning-fg" : "border-line bg-surface text-fg-2",
        className,
      )}
    >
      {modifierRuleText(group)}
    </span>
  )
}
