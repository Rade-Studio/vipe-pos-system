"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PIN_MAX_LENGTH, pinDigits } from "@/lib/terminal/pin"
import { cn } from "@/lib/utils"

interface PinFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  autoFocus?: boolean
}

/** A masked numeric PIN input (4-6 digits) with its label, for the PIN dialogs. */
export function PinField({ label, value, onChange, invalid, describedBy, autoFocus }: PinFieldProps) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_MAX_LENGTH}
        autoFocus={autoFocus}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(pinDigits(event.target.value))}
        className={cn(
          "h-12 font-mono text-xl tracking-[0.4em]",
          invalid && "border-status-danger-line focus-visible:ring-status-danger-line",
        )}
      />
    </div>
  )
}

/** The refusal under a PIN form, announced to screen readers. */
export function PinFormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-lg bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">
      {message}
    </p>
  )
}
