"use client"
import { Button } from "@/components/ui/button"
import { SkipBackIcon as Backspace, X, CornerDownLeft } from "lucide-react"
import {useEffect} from "react";

interface NumericKeypadProps {
  onValueChange: (value: string) => void
  value: string
  maxLength?: number
  allowDecimal?: boolean
  className?: string
  onEnter?: () => void
}

export function NumericKeypad({
  onValueChange,
  value,
  maxLength = 10,
  allowDecimal = false,
  className = "",
  onEnter,
}: NumericKeypadProps) {
  const handleNumberClick = (num: number) => {
    if (value.length >= maxLength) return
    onValueChange(value + num.toString())
  }

  const handleDecimalClick = () => {
    if (!allowDecimal || value.includes(".")) return
    onValueChange(value + ".")
  }

  const handleBackspace = () => {
    onValueChange(value.slice(0, -1))
  }

  const handleClear = () => {
    onValueChange("")
  }

  const handleEnter = () => {
    if (onEnter) {
      onEnter()
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Keys typed into another field belong to that field, not to the amount.
      const target = e.target as HTMLElement | null
      if (
        target instanceof HTMLElement &&
        (target.closest("input, textarea, select") || target.isContentEditable)
      ) {
        return
      }
      if (e.key >= "0" && e.key <= "9") {
        if (value.length < maxLength) {
          onValueChange(value + e.key);
        }
      } else if (e.key === "Backspace") {
        onValueChange(value.slice(0, -1));
      } else if (e.key === "Enter") {
        onEnter?.();
      } else if (e.key === "." && allowDecimal && !value.includes(".")) {
        onValueChange(value + ".");
      } else if (e.key.toLowerCase() === "c") {
        // tecla "c" para limpiar
        onValueChange("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [value, maxLength, allowDecimal, onValueChange, onEnter]);

  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
        <Button
          key={num}
          type="button"
          variant="outline"
          className="h-12 text-lg font-medium"
          onClick={() => handleNumberClick(num)}
        >
          {num}
        </Button>
      ))}

      {allowDecimal ? (
        <Button type="button" variant="outline" className="h-12 text-lg font-medium" onClick={handleDecimalClick}>
          .
        </Button>
      ) : (
        <Button type="button" variant="outline" className="h-12 text-lg font-medium" onClick={handleClear} aria-label="Limpiar">
          <X className="h-5 w-5" />
        </Button>
      )}

      <Button type="button" variant="outline" className="h-12 text-lg font-medium" onClick={() => handleNumberClick(0)}>
        0
      </Button>

      <Button type="button" variant="outline" className="h-12 text-lg font-medium" onClick={handleBackspace} aria-label="Borrar">
        <Backspace className="h-5 w-5" />
      </Button>

      <Button type="button" variant="default" className="h-12 col-span-3 text-lg font-medium" onClick={handleEnter}>
        <CornerDownLeft className="h-5 w-5 mr-2" />
        Aceptar
      </Button>
    </div>
  )
}
