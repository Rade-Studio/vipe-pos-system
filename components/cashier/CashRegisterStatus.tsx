"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { OpenRegisterDialog } from "@/components/cashier/OpenRegisterDialog"
import { CloseRegisterDialog } from "@/components/cashier/CloseRegisterDialog"
import { AddCashDialog } from "@/components/cashier/AddCashDialog"
import { WithdrawCashDialog } from "@/components/cashier/WithdrawCashDialog"
import { formatCurrency } from "@/utils/helpers"
import { AlertCircle, CheckCircle2, PlusCircle, MinusCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"

export function CashRegisterStatus() {
  const [openDialog, setOpenDialog] = useState(false)
  const [closeDialog, setCloseDialog] = useState(false)
  const [addCashDialog, setAddCashDialog] = useState(false)
  const [withdrawCashDialog, setWithdrawCashDialog] = useState(false)
  const { toast } = useToast()

  const { isRegisterOpen, getCurrentRegisterSummary } = useCashRegisterStore()
  const isOpen = isRegisterOpen()
  const summary = getCurrentRegisterSummary()

  return (
    <>
      <div className="mb-6">
        {isOpen ? (
          <Alert className="bg-green-50 border-green-200 shadow-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-800 font-semibold">Caja Abierta</AlertTitle>
            <AlertDescription className="text-green-700">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mt-2 gap-2">
                <div className="flex items-center">
                  <span className="mr-1">Efectivo actual:</span>
                  <span className="font-medium text-green-900">{formatCurrency(summary?.finalCash || 0)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddCashDialog(true)}
                    className="bg-white hover:bg-green-50"
                  >
                    <PlusCircle className="h-4 w-4 mr-1 text-green-600" />
                    Agregar Efectivo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWithdrawCashDialog(true)}
                    className="bg-white hover:bg-green-50"
                  >
                    <MinusCircle className="h-4 w-4 mr-1 text-green-600" />
                    Retirar Efectivo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCloseDialog(true)}
                    className="bg-white hover:bg-green-50"
                  >
                    Cerrar Caja
                  </Button>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" className="shadow-sm">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-semibold">Caja Cerrada</AlertTitle>
            <AlertDescription>
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mt-2 gap-2">
                <div>Debe abrir la caja para procesar pagos.</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenDialog(true)}
                  className="bg-white hover:bg-red-50"
                >
                  Abrir Caja
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <OpenRegisterDialog open={openDialog} onOpenChange={setOpenDialog} />
      <CloseRegisterDialog open={closeDialog} onOpenChange={setCloseDialog} />
      <AddCashDialog open={addCashDialog} onOpenChange={setAddCashDialog} />
      <WithdrawCashDialog open={withdrawCashDialog} onOpenChange={setWithdrawCashDialog} />
    </>
  )
}
