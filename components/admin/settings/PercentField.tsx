"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { clampSetting } from "./settings-draft"

interface PercentFieldProps {
  id: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  disabled?: boolean
}

/** Numeric input and slider bound to the same percentage. */
export function PercentField({ id, value, onChange, min, max, step, disabled }: PercentFieldProps) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = () => {
    const next = clampSetting(text, { min, max })
    if (next === null) setText(String(value))
    else if (next !== value) onChange(next)
    else setText(String(value))
  }

  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={`${id} control deslizante`}
        value={[Math.min(max, Math.max(min, value))]}
        onValueChange={(next) => onChange(next[0])}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="flex-1"
      />
      <div className="relative w-24 shrink-0">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            const next = clampSetting(event.target.value, { min, max })
            if (next !== null && String(next) === event.target.value) onChange(next)
          }}
          onBlur={commit}
          disabled={disabled}
          className="pr-7 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute right-2.5 top-2.5 text-sm text-muted-foreground">%</span>
      </div>
    </div>
  )
}
