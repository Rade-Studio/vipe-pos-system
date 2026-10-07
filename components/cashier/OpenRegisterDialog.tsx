"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { log } from "@/lib/log"
import { Label } from "@/components/ui/label"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { toast } from "@/utils/toast"
import { Loader2 } from "lucide-react"

interface OpenRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function OpenRegisterDialog({ open, onOpenChange, onSuccess }: OpenRegisterDialogProps) {
  const [initialCash, setInitialCash] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { openRegister } = useCashRegisterStore()

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }

    const cashAmount = Number.parseFloat(initialCash || "0")

    if (isNaN(cashAmount) || cashAmount < 0) {
      setError("Por favor ingrese un valor válido")
      toast.error("Por favor ingrese un valor válido para el efectivo inicial")
      return
    }

    setIsSubmitting(true)

    try {
      const success = await openRegister(cashAmount)

      if (success) {
        toast.success(`La caja ha sido abierta con un efectivo inicial de ${formatCurrency(cashAmount)}`)
        setInitialCash("")
        setError(null)
        onOpenChange(false)

        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error("No se pudo abrir la caja")
      }
    } catch (error) {
      log.error("Error al abrir la caja:", { error: String(error) })
      toast.error("Ocurrió un error al abrir la caja")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCashChange = (value: string) => {
    setInitialCash(value)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Apertura de Caja</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => handleSubmit(e)}>
          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="initialCash">Efectivo Inicial</Label>
              <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                {initialCash ? formatCurrency(Number(initialCash)) : "$ 0"}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <NumericKeypad
              value={initialCash}
              onValueChange={handleCashChange}
              allowDecimal={false}
              className="mt-4"
              onEnter={handleSubmit}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Abrir Caja
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
