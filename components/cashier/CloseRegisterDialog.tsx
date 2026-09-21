"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { log } from "@/lib/log"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { useState } from "react"
import type { CashRegisterSummary } from "@/types/cash-register"
import { toast } from "@/utils/toast"

interface CloseRegisterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (summary: CashRegisterSummary) => void
}

export function CloseRegisterDialog({ open, onOpenChange, onSuccess }: CloseRegisterDialogProps) {
  const [summary, setSummary] = useState<CashRegisterSummary | null>(null)
  const { closeRegister, getCurrentRegisterSummary } = useCashRegisterStore()

  // Obtener el resumen actual para mostrar la vista previa
  const currentSummary = getCurrentRegisterSummary()

  const handleClose = async () => {
    try {
      // Obtener el resumen actual antes de cerrar la caja
      const currentSummary = getCurrentRegisterSummary()

      if (!currentSummary) {
        toast.error("No se pudo obtener el resumen de la caja")
        return
      }

      // Cerrar la caja
      const closingSummary = await closeRegister()

      if (closingSummary) {
        // Usar el resumen actual si el cierre devuelve null
        setSummary(closingSummary || currentSummary)

        toast.success(
          `La caja ha sido cerrada correctamente con un total de ${formatCurrency((closingSummary || currentSummary).totalSales || 0)}`,
        )

        if (onSuccess) {
          onSuccess(closingSummary || currentSummary)
        }
      } else {
        toast.error("No se pudo cerrar la caja")
      }
    } catch (error) {
      log.error("Error al cerrar la caja:", { error: String(error) })
      toast.error("Ocurrió un error al cerrar la caja")
    }
  }

  const handleFinish = () => {
    setSummary(null)
    onOpenChange(false)
  }

  // Si ya tenemos un resumen, mostramos la pantalla de resumen final
  if (summary) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cierre de Caja Completado</DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <h3 className="font-semibold text-lg">Resumen del Día</h3>

            <div className="space-y-2">
              <div className="flex justify-between">
                <span>Efectivo Inicial:</span>
                <span>{formatCurrency(summary.initialCash || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span>Ventas en Efectivo:</span>
                <span>{formatCurrency(summary.totalCash || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span>Cambio Entregado:</span>
                <span>-{formatCurrency(summary.totalChange || 0)}</span>
              </div>

              <div className="flex justify-between font-medium">
                <span>Efectivo Final:</span>
                <span>{formatCurrency(summary.finalCash || 0)}</span>
              </div>

              <div className="border-t my-2"></div>

              <div className="flex justify-between">
                <span>Ventas por Transferencia:</span>
                <span>{formatCurrency(summary.totalTransfer || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span>Ventas por Nequi:</span>
                <span>{formatCurrency(summary.totalNequi || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span>Ventas por Bancolombia:</span>
                <span>{formatCurrency(summary.totalBancolombia || 0)}</span>
              </div>

              <div className="border-t my-2"></div>

              <div className="flex justify-between font-bold text-lg">
                <span>Total Ventas:</span>
                <span>{formatCurrency(summary.totalSales || 0)}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleFinish}>Finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Pantalla de confirmación de cierre
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar Caja</DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <p>¿Está seguro que desea cerrar la caja?</p>

          {currentSummary && (
            <div className="space-y-2 bg-muted p-4 rounded-md">
              <h3 className="font-semibold">Vista Previa del Cierre</h3>

              <div className="flex justify-between">
                <span>Efectivo Final:</span>
                <span>{formatCurrency(currentSummary.finalCash || 0)}</span>
              </div>

              <div className="flex justify-between">
                <span>Total Ventas:</span>
                <span>{formatCurrency(currentSummary.totalSales || 0)}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="default" onClick={handleClose}>
            Cerrar Caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
