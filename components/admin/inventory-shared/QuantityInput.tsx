"use client"

import { forwardRef, useEffect, useId, useState, type KeyboardEvent } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseQuantityInput, quantityPresets, quantityStep } from "@/lib/inventory/units"
import { cn } from "@/lib/utils"

export interface QuantityInputProps {
  /** Committed quantity in `unit`; null shows an empty field. */
  value: number | null
  /** Target unit: typed units ("1,5 kg", "1/2 l") convert into it. */
  unit: string
  /** Called with every valid quantity (typing, steppers, presets). */
  onChange: (value: number) => void
  /** Enter with a valid quantity, after `onChange`. */
  onCommit?: (value: number) => void
  label: string
  id?: string
  showPresets?: boolean
  showSteppers?: boolean
  className?: string
  inputClassName?: string
}

const round = (value: number) => Math.round(value * 10_000) / 10_000
const display = (value: number | null) => (value === null ? "" : String(round(value)).replace(".", ","))

/**
 * Text quantity field that understands units: "1,5 kg" in a g field becomes
 * 1500. ↑/↓ and the +/− buttons move by the unit's step; chips set presets.
 */
export const QuantityInput = forwardRef<HTMLInputElement, QuantityInputProps>(function QuantityInput(
  { value, unit, onChange, onCommit, label, id, showPresets = false, showSteppers = true, className, inputClassName },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`
  const [text, setText] = useState(display(value))
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const step = quantityStep(unit)

  useEffect(() => {
    if (!editing) setText(display(value))
  }, [value, editing])

  const apply = (next: number) => {
    const rounded = round(next)
    if (!(rounded > 0)) return
    setText(display(rounded))
    setError(null)
    onChange(rounded)
  }

  const stepBy = (direction: 1 | -1) => {
    const current = value ?? 0
    const next = current + direction * step
    apply(next > 0 ? next : step)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault()
      stepBy(event.key === "ArrowUp" ? 1 : -1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const parsed = parseQuantityInput(text, unit)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      apply(parsed.value)
      onCommit?.(round(parsed.value))
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1">
        {showSteppers && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => stepBy(-1)}
            aria-label={`Disminuir ${label}`}
            tabIndex={-1}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
        )}
        <div className="relative min-w-0 flex-1">
          <Input
            ref={ref}
            id={inputId}
            value={text}
            inputMode="decimal"
            autoComplete="off"
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn("pr-14 tabular-nums", inputClassName)}
            onFocus={(event) => {
              setEditing(true)
              event.currentTarget.select()
            }}
            onChange={(event) => {
              setText(event.target.value)
              const parsed = parseQuantityInput(event.target.value, unit)
              if (parsed.ok) {
                setError(null)
                onChange(round(parsed.value))
              }
            }}
            onBlur={() => {
              setEditing(false)
              const parsed = parseQuantityInput(text, unit)
              if (parsed.ok) {
                setText(display(round(parsed.value)))
                setError(null)
              } else if (text.trim() !== "") {
                setError(parsed.error)
              } else {
                setText(display(value))
              }
            }}
            onKeyDown={handleKeyDown}
          />
          <span
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
            aria-hidden
          >
            {unit}
          </span>
        </div>
        {showSteppers && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => stepBy(1)}
            aria-label={`Aumentar ${label}`}
            tabIndex={-1}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {showPresets && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Cantidades rápidas para ${label}`}>
          {quantityPresets(unit).map((preset) => (
            <button
              key={preset}
              type="button"
              tabIndex={-1}
              onClick={() => apply(preset)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                value === preset && "border-primary text-foreground",
              )}
            >
              {display(preset)} {unit}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
