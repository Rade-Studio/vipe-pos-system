import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface PanelProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** A thin bordered block with an optional compact header (dashboard panels). */
export function Panel({ title, description, actions, children, className, contentClassName }: PanelProps) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card text-card-foreground", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  )
}

interface SectionHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

/** Heading of a block inside a page (e.g. Categorías inside Menú). */
export function SectionHeader({ title, description, actions, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Toolbar row: controls on the left, primary action pushed to the right on ≥ sm. */
export function Toolbar({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      {children}
      {actions && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  )
}

/** Classes for a Radix `TabsList` rendered as a compact segmented toggle. */
export const segmentedListClass = "inline-flex h-9 w-full sm:w-auto"
export const segmentedTriggerClass = "flex-1 sm:flex-none"
