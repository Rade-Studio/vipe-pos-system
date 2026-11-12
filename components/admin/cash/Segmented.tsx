"use client"

import { cn } from "@/lib/utils"

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}

/** A compact toggle group (pressed buttons, 44 px targets) instead of nested tabs. */
export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex w-full rounded-md bg-muted p-1 sm:w-auto", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-11 flex-1 rounded-sm px-4 text-sm font-medium text-muted-foreground transition-colors sm:flex-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            value === option.value && "bg-background text-foreground shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled block that screen readers list as a region. */
export function Region({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="region" aria-label={label} className={cn("min-w-0", className)}>
      {children}
    </div>
  )
}
