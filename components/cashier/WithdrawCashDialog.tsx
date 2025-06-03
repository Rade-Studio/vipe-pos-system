"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { toast } from "@/utils/toast"
import { NumericKeypad } from "@/components/ui/numeric-keypad"

interface WithdrawCashDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function WithdrawCashDialog({ open, onOpenChange, onSuccess }: WithdrawCashDialogProps) {
  const [amount, setAmount] = useState<string>("")
  const [formattedAmount, setFormattedAmount] = useState<string>("$ 0")
  const [description, setDescription] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  const { addCashTransaction, getCurrentRegisterSummary, currentRegister } = useCashRegisterStore()

  // Resetear el estado cuando se abre el diálogo
  useEffect(() => {
    if (open) {
      setAmount("")
      setFormattedAmount("$ 0")
      setDescription("")
      setError(null)
    }
  }, [open])

  // Actualizar el monto formateado cuando cambia el monto
  useEffect(() => {
    if (amount) {
      const numericAmount = Number.parseFloat(amount)
      if (!isNaN(numericAmount)) {
        setFormattedAmount(formatCurrency(numericAmount))
      } else {
        setFormattedAmount("$ 0")
      }
    } else {
      setFormattedAmount("$ 0")
    }
  }, [amount])

  const handleAmountChange = (value: string) => {
    setAmount(value)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const numericAmount = Number.parseFloat(amount)

    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      setError("Por favor ingrese un monto válido")
      return
    }

    if (!description.trim()) {
      setError("Por favor ingrese una descripción")
      return
    }

    // Verificar si hay suficiente efectivo en caja
    const currentCash = getCurrentRegisterSummary()?.finalCash || 0
    if (numericAmount > currentCash) {
      setError(`No hay suficiente efectivo en caja. Disponible: ${formatCurrency(currentCash)}`)
      return
    }

    if (!currentRegister) {
      setError("No hay una caja abierta")
      return
    }

    try {
      // Usar addCashTransaction en lugar de withdrawCash
      await addCashTransaction(
        currentRegister.id,
        numericAmount,
        "withdrawal", // Tipo de transacción: retiro
        description,
      )

      toast.success(`Se ha retirado ${formatCurrency(numericAmount)} de la caja`)
      onOpenChange(false)
      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error("Error al retirar efectivo:", error)
      setError("Ocurrió un error al retirar el efectivo")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirar Efectivo</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="py-4 space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <div className="flex justify-between">
                <span>Efectivo actual en caja:</span>
                <span className="font-medium">{formatCurrency(getCurrentRegisterSummary()?.finalCash || 0)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Monto a Retirar</Label>
              <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                {amount ? formatCurrency(Number(amount)) : formatCurrency(0)}
              </div>
            </div>
          </div>

          {/* Teclado numérico siempre visible */}
          <div className="border rounded-md p-4">
            <NumericKeypad value={amount} onValueChange={handleAmountChange} allowDecimal={true} className="w-full" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción / Motivo</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ingrese el motivo del retiro"
              className="min-h-[80px]"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">Retirar Efectivo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
