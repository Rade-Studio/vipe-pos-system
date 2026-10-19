import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface SettingsSectionProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/** A bordered group of settings rows with a title. */
export function SettingsSection({ title, description, actions, children, className }: SettingsSectionProps) {
  return (
    <section className={cn("rounded-lg border bg-card text-card-foreground", className)}>
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="divide-y">{children}</div>
    </section>
  )
}

interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}

/** Label and description on the left, the control on the right (stacked on mobile). */
export function SettingsRow({ label, description, htmlFor, children, className }: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-8",
        className,
      )}
    >
      <div className="space-y-1 md:max-w-[50%]">
        <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
          {label}
        </label>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="w-full md:w-auto md:min-w-[280px] md:max-w-sm">{children}</div>
    </div>
  )
}
