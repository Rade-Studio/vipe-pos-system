"use client"

import type { ReactNode } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Check, Delete, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { focusRing } from "@/components/cashier/cashier-ui"
import { cn } from "@/lib/utils"
import { initials } from "./flow"

/**
 * The step sheet of F3 (design/anulaciones/01, L16), shared with the shared
 * terminal's PIN sheet (F4b): a bottom sheet on a phone, a dialog from 768 px.
 */
export const STEP_SHEET_CLASS = cn(
  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl border border-line text-fg shadow-elevated outline-none [background:linear-gradient(var(--surface),var(--surface)),var(--canvas)]",
  "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-[min(560px,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card",
)

export function StepSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            // The sheet itself takes the focus, not its close button (keys still reach every control).
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              ;(event.currentTarget as HTMLElement | null)?.focus()
            }}
            className={STEP_SHEET_CLASS}
          >
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  )
}

/** Eyebrow, title and the close button of a step. */
export function StepHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="flex items-start gap-3 px-5 pb-2 pt-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-muted-fg">{eyebrow}</p>
        <DialogPrimitive.Title asChild>
          <h2 className="mt-0.5 text-xl font-bold text-fg">{title}</h2>
        </DialogPrimitive.Title>
      </div>
      <DialogPrimitive.Close asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 flex-none" aria-label="Cerrar">
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </DialogPrimitive.Close>
    </header>
  )
}

/** The dots of a 4-6 digit PIN. */
export function PinDots({ length, wrong }: { length: number; wrong?: boolean }) {
  return (
    <div role="img" aria-label={`${length} de 4 a 6 dígitos`} className="flex justify-center gap-3 py-1">
      {Array.from({ length: 6 }).map((_, index) => (
        <i
          key={index}
          className={cn(
            "h-3.5 w-3.5 rounded-full border-2",
            index < length ? "border-fg bg-fg" : index < 4 ? "border-line-strong" : "border-dashed border-line",
            wrong && "border-status-danger-fg",
          )}
        />
      ))}
    </div>
  )
}

export function Options({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {children}
    </div>
  )
}

export function Option({
  checked,
  disabled,
  danger,
  onSelect,
  children,
}: {
  checked: boolean
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      onClick={onSelect}
      className={cn(
        "flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm",
        checked ? "border-brand bg-brand-tint" : "border-line bg-surface hover:bg-surface-2",
        disabled && "opacity-70",
        danger && "border-status-danger-line bg-status-danger-bg",
        focusRing,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-5 w-5 flex-none place-items-center rounded-full border-2",
          checked ? "border-brand bg-brand text-brand-contrast" : "border-line-strong",
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      {children}
    </button>
  )
}

export function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="grid h-10 w-10 flex-none place-items-center rounded-full bg-surface-2 text-sm font-bold text-fg-2">
      {initials(name)}
    </span>
  )
}

export function Alert({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        tone === "danger"
          ? "border-status-danger-line bg-status-danger-bg text-status-danger-fg"
          : "border-status-warning-line bg-status-warning-bg text-status-warning-fg",
      )}
    >
      {children}
    </div>
  )
}

export function PinPad({
  disabled,
  canSubmit,
  busy,
  onDigit,
  onDelete,
  onSubmit,
  submitLabel = "Autorizar",
}: {
  submitLabel?: string
  disabled: boolean
  canSubmit: boolean
  busy: boolean
  onDigit: (digit: string) => void
  onDelete: () => void
  onSubmit: () => void
}) {
  const key = cn(
    "min-h-[56px] rounded-lg border border-line bg-surface-2 text-xl font-semibold tabular-nums text-fg hover:bg-surface disabled:opacity-50",
    focusRing,
  )
  return (
    <div role="group" aria-label="Teclado del PIN" className="mx-auto grid w-full max-w-xs grid-cols-3 gap-2">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <button key={digit} type="button" className={key} disabled={disabled} onClick={() => onDigit(digit)}>
          {digit}
        </button>
      ))}
      <button type="button" className={cn(key, "text-sm")} disabled={disabled} onClick={onDelete} aria-label="Borrar">
        <Delete className="mx-auto h-5 w-5" aria-hidden />
      </button>
      <button type="button" className={key} disabled={disabled} onClick={() => onDigit("0")}>
        0
      </button>
      <button
        type="button"
        className={cn(key, "border-brand bg-brand text-base text-brand-contrast hover:bg-brand-strong")}
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {busy ? "…" : submitLabel}
      </button>
    </div>
  )
}
