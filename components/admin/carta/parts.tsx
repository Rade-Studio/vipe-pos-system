"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

/** Artboard 02 section card: title and a one-line purpose. */
export function CartaCard({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-lg border bg-card text-card-foreground">
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="space-y-0.5">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-5 px-4 py-4 sm:px-6">{children}</div>
    </section>
  )
}

/** A labelled control with its hint, or its error in place of the hint. */
export function Field({
  id,
  label,
  hint,
  error,
  aside,
  children,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** A switch row: title and explanation on the left, the switch on the right. */
export function SwitchRow({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-none">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/** Toggle chip (tags, categories): `aria-pressed` carries the state. */
export function ToggleChip({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean
  onClick: () => void
  label?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  )
}

export function StaticChip({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "border-status-ok-line bg-status-ok-bg text-status-ok-fg",
        tone === "warn" && "border-status-warning-line bg-status-warning-bg text-status-warning-fg",
        tone === "muted" && "border-line text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

/** A destructive-consequence confirmation (slug change, QR regeneration). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  // No Radix trigger opens it, so remember the opener (before focus moves in) and return there.
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [open])
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          const target = opener.current
          if (!target?.isConnected) return
          event.preventDefault()
          target.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Whether the viewport is at least `px` wide (false without matchMedia). */
export function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(`(min-width: ${px}px)`)
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener?.("change", sync)
    return () => query.removeEventListener?.("change", sync)
  }, [px])
  return wide
}

export const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
