"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { toast } from "@/utils/toast"
import { Loader2 } from "lucide-react"

interface AddCashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function AddCashDialog({ open, onOpenChange, onSuccess }: AddCashDialogProps) {
  const [cashAmount, setCashAmount] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { addCashToRegister, getCurrentRegisterSummary } = useCashRegisterStore()

  // Obtener el efectivo actual en caja
  const currentSummary = getCurrentRegisterSummary()
  const currentCash = currentSummary?.finalCash || 0

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault()
    }

    const amount = Number.parseFloat(cashAmount || "0")

    if (isNaN(amount) || amount <= 0) {
      setError("Por favor ingrese un valor válido mayor a cero")
      toast.error("Por favor ingrese un valor válido para el efectivo a agregar")
      return
    }

    setIsSubmitting(true)

    try {
      const success = await addCashToRegister(amount)

      if (success) {
        toast.success(`Se ha agregado ${formatCurrency(amount)} a la caja`)
        setCashAmount("")
        setError(null)
        onOpenChange(false)

        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error("No se pudo agregar efectivo a la caja")
      }
    } catch (error) {
      console.error("Error al agregar efectivo a la caja:", error)
      toast.error("Ocurrió un error al agregar efectivo a la caja")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCashChange = (value: string) => {
    setCashAmount(value)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar Efectivo a Caja</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => handleSubmit(e)}>
          <div className="py-4 space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <div className="flex justify-between">
                <span>Efectivo actual en caja:</span>
                <span className="font-medium">{formatCurrency(currentCash)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cashAmount">Efectivo a Agregar</Label>
              <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                {cashAmount ? formatCurrency(Number(cashAmount)) : formatCurrency(0)}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <NumericKeypad
              value={cashAmount}
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
              Agregar Efectivo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
