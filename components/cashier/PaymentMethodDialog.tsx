"use client"

import type React from "react"

import { useState, useEffect, useMemo, JSX } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { formatCurrency } from "@/utils/helpers"
import { CreditCard, Banknote, Smartphone, Printer, ArrowLeft, Check, AlertTriangle, PlusCircle } from "lucide-react"
import type { PaymentMethod } from "@/types/cash-register"
import { usePOSStore } from "@/store/use-pos-store"
import { useConfigStore } from "@/store/use-config-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { PrintableInvoice, CartItem } from "@/types"
import { useToast } from "@/hooks/use-toast"
import { NumericKeypad } from "@/components/ui/numeric-keypad"
import { toast } from "@/utils/toast"
import { Switch } from "@/components/ui/switch"
import { AddCashDialog } from "@/components/cashier/AddCashDialog"
import { orderService, tableService } from "@/lib/supabase/service"
import { supabase } from "@/lib/supabase/client"
import {cn} from "@/lib/utils";

interface PaymentMethodDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  tableId: string
  amount: number
  tableTotal: number // Nuevo prop para el total de la mesa
  onSuccess: () => void
  isPartialPayment?: boolean
  selectedItems?: string[]
}

export function PaymentMethodDialog({
  open,
  onOpenChange,
  orderId,
  tableId,
  amount,
  tableTotal,
  onSuccess,
  isPartialPayment = false,
  selectedItems = [],
}: PaymentMethodDialogProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "multiple">("cash")
  const [cashReceived, setCashReceived] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [showInvoice, setShowInvoice] = useState(false)
  const [invoiceData, setInvoiceData] = useState<PrintableInvoice | null>(null)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [selectedMethods, setSelectedMethods] = useState<Record<PaymentMethod, boolean>>({
    cash: false,
    transfer: false,
    nequi: false,
    bancolombia: false,
  })
  const [paymentAmounts, setPaymentAmounts] = useState<Record<PaymentMethod, string>>({
    cash: "",
    transfer: "",
    nequi: "",
    bancolombia: "",
  });
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [paymentLeft, setPaymentLeft] = useState<string>("")
  const [showCashInput, setShowCashInput] = useState(false)
  const [showMultiplePayment, setShowMultiplePayment] = useState(false)
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false)
  const [includeTip, setIncludeTip] = useState(true)
  const [showAddCashDialog, setShowAddCashDialog] = useState(false)
  const [insufficientCash, setInsufficientCash] = useState(false)
  const [orderData, setOrderData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState(false)

  const { addTransaction, isRegisterOpen, hasEnoughCashForChange, getCurrentRegisterSummary } = useCashRegisterStore()
  const { completePayment, completePartialPayment, undoPartialPayment, calculateOrderBill } = usePOSStore()
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()
  const { toast: toastHook } = useToast()

  const paymentLabels: Record<PaymentMethod, string> = {
    cash: "Efectivo",
    transfer: "Transferencia Bancaria",
    nequi: "Nequi",
    bancolombia: "Bancolombia App"
  };
  const paymentIcons: Record<PaymentMethod, JSX.Element> = {
    cash: <Banknote className="mr-2 h-5 w-5" />,
    transfer: <CreditCard className="mr-2 h-5 w-5" />,
    nequi: <Smartphone className="mr-2 h-5 w-5" />,
    bancolombia: <Smartphone className="mr-2 h-5 w-5" />
  };
  const paymentMethods: PaymentMethod[] = ["cash", "transfer", "nequi", "bancolombia"];

  // Cargar la orden directamente desde la base de datos
  useEffect(() => {
    async function loadOrderData() {
      if (!open || !orderId) return

      setLoading(true)
      try {
        // Obtener la orden desde la base de datos
        const order = await orderService.getById(orderId)
        if (!order) {
          throw new Error("No se pudo encontrar la orden")
        }

        // Obtener información de la mesa
        const tableInfo = await tableService.getById(order.table_id)

        // Obtener información del mesero
        const { data: waiterInfo } = await supabase
          .from("profiles")
          .select("id, full_name")
          .eq("id", order.waiter_id)
          .single()

        setOrderData({
          ...order,
          tableInfo,
          waiterInfo,
        })
      } catch (error) {
        toast.error("No se pudo cargar la información de la orden")
        onOpenChange(false)
      } finally {
        setLoading(false)
      }
    }

    loadOrderData()
  }, [open, orderId, onOpenChange])

  // Calcular el total sin propina (subtotal + impuestos)
  const subtotalWithTax = orderData ? orderData.subtotal + orderData.tax : 0

  // Usar el total sin propina si includeTip es false
  const finalAmount = includeTip ? amount : subtotalWithTax

  // Calcular el cambio
  const cashAmount = Number.parseFloat(cashReceived || "0")
  const change = !isNaN(cashAmount) ? Math.max(0, cashAmount - finalAmount) : 0

  const totalPaid = useMemo(
    () =>
      Object.values(paymentAmounts).reduce(
        (sum, amount) => sum + (Number(amount) || 0),
        0,
      ),
    [paymentAmounts],
  )

  const changeMultiple = Math.max(0, totalPaid - finalAmount)

  useEffect(() => {
    setPaymentLeft((finalAmount - totalPaid).toString())
  }, [finalAmount, totalPaid])

  const confirmDisabled = processingPayment || totalPaid < finalAmount

  // Verificar si hay suficiente efectivo para dar cambio
  const checkCashAvailability = () => {
    if (paymentMethod === "cash" && change > 0) {
      const hasEnough = hasEnoughCashForChange(change)
      setInsufficientCash(!hasEnough)
      return hasEnough
    }
    return true
  }

  // Obtener todos los productos de la orden
  const orderItems = useMemo(() => {
    if (!orderData || !orderData.order_items) return []

    // Convertir los items de la orden al formato CartItem
    return orderData.order_items.map(
      (item: any): CartItem => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        comments: item.comments || undefined,
        categoryId: item.category_id || "",
        originalPrice: item.original_price,
        discountAmount: item.discount_amount,
        discountPercentage: item.discount_percentage,
        promotionId: item.promotion_id,
        promotionName: item.promotion_name,
      }),
    )
  }, [orderData])

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()

    // Verificar si la caja está abierta
    if (!isRegisterOpen()) {
      toast.error("La caja debe estar abierta para procesar pagos")
      return
    }

    // Verificar si tenemos los datos de la orden
    if (!orderData) {
      toast.error("No se pudo cargar la información de la orden")
      return
    }

    // Generar la vista previa de la factura
    generateInvoicePreview()
  }

  const generateInvoicePreview = () => {
    try {
      if (!orderData || !orderData.tableInfo || !orderData.waiterInfo) {
        toast.error("No se pudo generar la factura: faltan datos")
        return
      }

      // Crear datos para la factura
      const invoiceNumber = orderId.substring(0, 8)

      // Determinar los items a incluir en la factura
      const invoiceItems =
        isPartialPayment && selectedItems.length > 0
          ? orderItems.filter((item) => selectedItems.includes(item.id))
          : orderItems

      // Calcular el total de descuentos
      const totalDiscounts = invoiceItems.reduce((sum, item) => {
        if (item.originalPrice && item.originalPrice > item.price) {
          return sum + (item.originalPrice - item.price) * item.quantity
        }
        return sum
      }, 0)

      console.log("Total de descuentos calculado:", totalDiscounts)

      // Calcular el total para los items seleccionados
      const bill = {
        subtotal: orderData.subtotal,
        tax: orderData.tax,
        taxPercentage: orderData.tax_percentage,
        tip: orderData.tip,
        tipPercentage: orderData.tip_percentage,
        total: orderData.total,
        totalDiscounts: totalDiscounts,
      }

      const invoice: PrintableInvoice = {
        invoiceNumber,
        date: new Date(),
        businessInfo: {
          name: businessName,
          address: businessAddress,
          phone: businessPhone,
          nit: businessNIT,
        },
        items: invoiceItems,
        bill: bill,
        waiter: orderData.waiterInfo.full_name,
        table: orderData.tableInfo.number,
        paymentMethod,
        multiplePayments: paymentMethod === "multiple" ? selectedMethods : undefined,
        cashReceived: paymentMethod === "cash" ? cashAmount : undefined,
        cashChange: paymentMethod === "cash" ? change : undefined,
      }

      console.log("Datos de factura generados:", {
        items: invoiceItems.length,
        totalDiscounts,
        bill,
      })

      // Guardar los datos de la factura y mostrar la vista previa
      setInvoiceData(invoice)
      setShowInvoice(true)
    } catch (error) {
      console.error("Error al generar la vista previa de la factura:", error)
      toast.error("Ocurrió un error al generar la vista previa de la factura")
    }
  }

  const handleCashReceivedChange = (value: string) => {
    setCashReceived(value)
    setError(null)
    setInsufficientCash(false)
  }

  const handleAmountChange = (method: PaymentMethod, value: string) => {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    setPaymentAmounts((prev) => ({ ...prev, [method]: parsed }));
  };

  const handleCompleteAmountPayment = (selectedMethod: PaymentMethod) => {
    const totalAmount = Object.values(paymentAmounts).reduce(
        (sum, amount) => sum + (Number(amount) || 0),
        0
    );

    setPaymentLeft(!isNaN(totalAmount) ? finalAmount - Number(totalAmount) : finalAmount);
    setSelectedMethod(null)
    setSelectedMethods((prev) => ({ ...prev, [selectedMethod]: true }));
  }

  const handleCashInputSubmit = () => {
    setPaying(true)

    const cashAmount = Number.parseFloat(cashReceived || "0")

    if (isNaN(cashAmount) || cashAmount < finalAmount) {
      setError(`El monto recibido debe ser al menos ${formatCurrency(finalAmount)}`)
      setPaying(false)
      return
    }

    // Verificar si hay suficiente efectivo para dar cambio
    if (!checkCashAvailability()) {
      setPaying(false)
      return
    }

    // Actualizar los datos de la factura con el efectivo recibido y el cambio
    if (invoiceData) {
      // Si no se incluye propina, ajustar el bill en la factura
      if (!includeTip && invoiceData.bill) {
        const updatedBill = {
          ...invoiceData.bill,
          tip: 0,
          tipPercentage: 0,
          total: invoiceData.bill.subtotal + invoiceData.bill.tax,
        }

        setInvoiceData({
          ...invoiceData,
          bill: updatedBill,
          cashReceived: cashAmount,
          cashChange: change,
        })
      } else {
        setInvoiceData({
          ...invoiceData,
          cashReceived: cashAmount,
          cashChange: change,
        })
      }
    }

    // Procesar el pago con el monto en efectivo
    processPayment()
  }

  const handleConfirmPayment = async () => {
    // Si el método de pago es efectivo, mostrar la pantalla para ingresar el monto
    if (paymentMethod === "cash") {
      setShowCashInput(true)
      return
    }

    if (paymentMethod === "multiple") {
      setShowMultiplePayment(true)
      return
    }

    // Para otros métodos de pago, mostrar la pantalla de confirmación
    setShowPaymentConfirmation(true)
  }

  const handlePaymentConfirmationSubmit = () => {
    // Actualizar los datos de la factura si no se incluye propina
    if (invoiceData && !includeTip && invoiceData.bill) {
      const updatedBill = {
        ...invoiceData.bill,
        tip: 0,
        tipPercentage: 0,
        total: invoiceData.bill.subtotal + invoiceData.bill.tax,
      }

      setInvoiceData({
        ...invoiceData,
        bill: updatedBill,
      })
    }

    // Procesar el pago
    processPayment()
  }

  const handleAddCashSuccess = () => {
    setShowAddCashDialog(false)
    setInsufficientCash(false)
    // Volver a verificar si ahora hay suficiente efectivo
    checkCashAvailability()
  }

  // Modificar la función processPayment para manejar mejor los errores
  const processPayment = async () => {
    if (!invoiceData || !orderData) return

    // Verificar nuevamente si hay suficiente efectivo para dar cambio
    if (paymentMethod === "cash" && change > 0 && !hasEnoughCashForChange(change)) {
      setInsufficientCash(true)
      return
    }

    if (paymentMethod === "multiple") {
      const totalAmount = Object.values(paymentAmounts).reduce(
          (sum, amount) => sum + (Number(amount) || 0),
          0
      );
      if (totalAmount < finalAmount) {
        setError("La totalidad de los pagos no coincide con la cantidad a pagar")
        return
      }

    }

    setProcessingPayment(true)

    try {
      const orderTableId = orderData.table_id
      const waiterId = orderData.waiter_id

      // Calcular el monto de propina
      const tipAmount = includeTip && orderData.tip ? orderData.tip : 0

      // Procesar el pago con el monto final (con o sin propina)
      const transaction = await addTransaction(
        orderId,
        orderTableId,
        finalAmount,
        paymentMethod,
        paymentMethod === "multiple" ? selectedMethods : undefined,
        paymentMethod === "multiple" ? paymentAmounts : undefined,
        paymentMethod === "cash" ? cashAmount : undefined,
        paymentMethod === "cash" ? change : undefined,
        waiterId,
        tipAmount,
      )

      if (transaction) {
        // Completar el pago en la base de datos
        let invoiceNumber

        try {
          if (isPartialPayment) {
            invoiceNumber = await orderService.completePayment(orderId, paymentMethod)
            // También actualizamos el store para mantener la coherencia
            await completePartialPayment(orderId, selectedItems)
          } else {
            invoiceNumber = await orderService.completePayment(orderId, paymentMethod)
            // También actualizamos el store para mantener la coherencia
            await completePayment(orderId)
          }
        } catch (error) {
          console.error("Error al completar pago en el store:", error)
          // Si hay un error al actualizar el store, pero la transacción se completó,
          // generamos un número de factura para continuar
          invoiceNumber = orderId.substring(0, 8)
        }

        // Actualizar el número de factura en los datos
        if (invoiceData) {
          setInvoiceData({
            ...invoiceData,
            invoiceNumber,
          })
        }

        toast.success(`Factura ${invoiceNumber} generada correctamente`)

        // Limpiar el formulario
        setPaymentMethod("cash")
        setCashReceived("")
        setError(null)
        setShowCashInput(false)
        setShowPaymentConfirmation(false)
        setPaymentLeft("")
        setSelectedMethod(null)

        setPaymentAmounts({
          cash: "",
          transfer: "",
          nequi: "",
          bancolombia: "",
        })

        onSuccess()
      } else {
        toast.error("Error al procesar el pago. Verifique que la caja esté abierta.")
      }
    } catch (error) {
      console.error("Error al procesar el pago:", error)
      toast.error("Ocurrió un error al procesar el pago")
    } finally {
      setProcessingPayment(false)
    }
  }

  const handleUndoPartialPayment = async () => {
    try {
      await orderService.deletePartialOrder(orderId)
      undoPartialPayment(orderId)
      setShowInvoice(false)
      onOpenChange(false)
      toast.success("Se ha deshecho el pago parcial")
    } catch (error) {
      console.error("Error al deshacer pago parcial:", error)
      toast.error("No se pudo deshacer el pago parcial")
    }
  }

  // Si estamos cargando los datos de la orden
  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cargando información de la orden...</DialogTitle>
          </DialogHeader>
          <div className="py-8 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Si no se pudo cargar la orden
  if (!orderData && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-center text-destructive">No se pudo cargar la información de la orden</p>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Si estamos mostrando la pantalla de confirmación para otros métodos de pago
  if (showPaymentConfirmation) {
    return (
      <Dialog open={showPaymentConfirmation} onOpenChange={(open) => !open && setShowPaymentConfirmation(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Confirmar Pago con{" "}
              {paymentMethod === "transfer"
                ? "Transferencia"
                : paymentMethod === "nequi"
                  ? "Nequi"
                  : paymentMethod === "bancolombia"
                    ? "Bancolombia App"
                    : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Mostrar desglose de valores */}
            <div className="space-y-2">
              <div className="flex justify-between text-md">
                <span>Subtotal + Impuestos:</span>
                <span>{formatCurrency(subtotalWithTax)}</span>
              </div>

              {orderData && orderData.tip > 0 && (
                <div className="flex justify-between text-md">
                  <span>Propina ({orderData.tip_percentage}%):</span>
                  <span>{formatCurrency(orderData.tip)}</span>
                </div>
              )}

              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total a Pagar:</span>
                <span>{formatCurrency(finalAmount)}</span>
              </div>
            </div>

            {/* Opción para incluir propina */}
            {orderData && orderData.tip > 0 && (
              <div className="flex items-center justify-between space-x-2 p-3 rounded-md border">
                <Label htmlFor="includeTipOther" className="cursor-pointer">
                  Incluir propina en el pago
                </Label>
                <Switch id="includeTipOther" checked={includeTip} onCheckedChange={setIncludeTip} />
              </div>
            )}

            <div className="p-4 bg-muted/20 rounded-md">
              <p className="text-center">
                Por favor, confirme que ha recibido el pago por {formatCurrency(finalAmount)} a través de{" "}
                {paymentMethod === "transfer"
                  ? "transferencia bancaria"
                  : paymentMethod === "nequi"
                    ? "Nequi"
                    : paymentMethod === "bancolombia"
                      ? "Bancolombia App"
                      : ""}
                .
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentConfirmation(false)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Volver
            </Button>
            <Button onClick={handlePaymentConfirmationSubmit} disabled={processingPayment}>
              <Check className="mr-2 h-4 w-4" />
              Confirmar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Si estamos mostrando la pantalla de ingreso de efectivo
  if (showCashInput) {
    return (
      <>
        <Dialog open={showCashInput} onOpenChange={(open) => !open && setShowCashInput(false)}>
          <DialogContent className="sm:max-w-[800px] p-0 overflow-hidden">
            <DialogHeader className="px-6 pt-6 pb-2">
              <DialogTitle>Ingreso de Efectivo</DialogTitle>
            </DialogHeader>

            <div className="flex flex-row h-[500px]">
              {/* Columna izquierda - Teclado numérico */}
              <div className="w-1/2 p-6 border-r">
                <div className="space-y-4">
                  <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                    {cashReceived ? formatCurrency(Number(cashReceived)) : "$ 0"}
                  </div>

                  <NumericKeypad
                    value={cashReceived}
                    onValueChange={handleCashReceivedChange}
                    allowDecimal={false}
                    className="mt-4"
                    onEnter={handleCashInputSubmit}
                  />
                </div>
              </div>

              {/* Columna derecha - Información y botones */}
              <div className="w-1/2 p-6 flex flex-col justify-between">
                <div className="space-y-6">
                  {/* Desglose de valores */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-md">
                      <span>Subtotal + Impuestos:</span>
                      <span>{formatCurrency(subtotalWithTax)}</span>
                    </div>

                    {orderData && orderData.tip > 0 && (
                      <div className="flex justify-between text-md">
                        <span>Propina ({orderData.tip_percentage}%):</span>
                        <span>{formatCurrency(orderData.tip)}</span>
                      </div>
                    )}

                    <div className="flex justify-between font-bold text-lg pt-2 border-t">
                      <span>Total a Pagar:</span>
                      <span>{formatCurrency(finalAmount)}</span>
                    </div>
                  </div>

                  {/* Opción para incluir propina */}
                  {orderData && orderData.tip > 0 && (
                    <div className="flex items-center justify-between space-x-2 p-3 rounded-md border">
                      <Label htmlFor="includeTip" className="cursor-pointer">
                        Incluir propina en el pago
                      </Label>
                      <Switch id="includeTip" checked={includeTip} onCheckedChange={setIncludeTip} />
                    </div>
                  )}

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  {insufficientCash && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium text-amber-800">No hay suficiente efectivo en caja</p>
                          <p className="text-sm text-amber-700 mt-1">
                            El efectivo actual en caja es {formatCurrency(getCurrentRegisterSummary()?.finalCash || 0)},
                            insuficiente para dar un cambio de {formatCurrency(change)}.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 bg-white border-amber-300 text-amber-800 hover:bg-amber-50"
                            onClick={() => setShowAddCashDialog(true)}
                          >
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Agregar Efectivo a Caja
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {cashReceived &&
                    !isNaN(Number(cashReceived)) &&
                    Number(cashReceived) >= finalAmount &&
                    !insufficientCash && (
                      <div className="p-4 bg-green-50 border border-green-200 rounded-md dark:bg-green-900/50 dark:border-green-800">
                        <div className="flex justify-between font-medium text-lg">
                          <span>Cambio a entregar:</span>
                          <span className="text-green-600 font-bold">{formatCurrency(change)}</span>
                        </div>
                      </div>
                    )}
                </div>

                <div className="flex justify-end space-x-2 mt-4">
                  <Button variant="outline" onClick={() => setShowCashInput(false)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver
                  </Button>
                  <Button
                    onClick={handleCashInputSubmit}
                    disabled={
                      !cashReceived ||
                      isNaN(Number(cashReceived)) ||
                      Number(cashReceived) < finalAmount ||
                      insufficientCash || paying
                    }
                  >
                    Confirmar Pago
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AddCashDialog open={showAddCashDialog} onOpenChange={setShowAddCashDialog} onSuccess={handleAddCashSuccess} />
      </>
    )
  }

  // Si estamos mostrando la pantalla de múltiples pagos, mostrar la vista de múltiples pagos
  if (showMultiplePayment) {
    return (
        <Dialog open={showMultiplePayment} onOpenChange={(open) => !open && setShowMultiplePayment(false)}>
          <DialogContent className="sm:max-w-[800px] md:h-full max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Múltiples pagos</DialogTitle>
            </DialogHeader>
            <div className="py-4">

              <div className="flex flex-col md:flex-row max-h-[80vh] overflow-y-auto">
                {/* Columna izquierda - Teclado numérico */}
                <div className="w-full md:w-1/2 p-6 border-b md:border-b-0 md:border-r">
                  <div className="space-y-4">
                    <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                      {selectedMethod ? formatCurrency(Number(paymentAmounts[selectedMethod as PaymentMethod] || 0)) : formatCurrency(0)}
                    </div>

                    <NumericKeypad
                        value={String(paymentAmounts[selectedMethod as PaymentMethod]) || ""}
                        onValueChange={(value) => handleAmountChange(selectedMethod as PaymentMethod, value)}
                        allowDecimal={false}
                        onEnter={() => handleCompleteAmountPayment(selectedMethod as PaymentMethod)}
                    />
                  </div>

                </div>


                {/* Columna derecha */}
                <div className="w-full md:w-1/2 p-6 flex flex-col justify-between">
                  <div className="space-y-6">
                    {/* Desglose de valores */}
                    <div className="space-y-2">

                      <div className="space-y-2">
                        <div className="flex justify-between text-md">
                          <span>Subtotal + Impuestos:</span>
                          <span>{formatCurrency(subtotalWithTax)}</span>
                        </div>

                        {orderData && orderData.tip > 0 && (
                            <div className="flex justify-between text-md">
                              <span>Propina ({orderData.tip_percentage}%):</span>
                              <span>{formatCurrency(orderData.tip)}</span>
                            </div>
                        )}

                        <div className="flex justify-between font-bold text-xl pt-2 border-t">
                          <span>Total a Pagar:</span>
                          <span>{formatCurrency(finalAmount)}</span>
                        </div>

                        {Number(paymentLeft) !== finalAmount && Number(paymentLeft) > 0 && (
                          <div className="flex justify-between font-bold text-xl pt-2 border-t">
                            <span className="text-primary">Pendiente:</span>
                            <span className="text-primary">{formatCurrency(Number(paymentLeft))}</span>
                          </div>
                        )}
                        {totalPaid > finalAmount && (
                          <div className="flex justify-between font-bold text-xl pt-2 border-t">
                            <span className="text-destructive">Total excedido:</span>
                            <span className="text-destructive">{formatCurrency(totalPaid - finalAmount)}</span>
                          </div>
                        )}
                        {totalPaid > 0 && (
                          <div className="space-y-1 pt-2 border-t">
                            <div className="flex justify-between text-lg font-bold">
                              <span>Total pagado:</span>
                              <span>{formatCurrency(totalPaid)}</span>
                            </div>
                            {changeMultiple > 0 && (
                              <div className="flex justify-between text-lg font-bold">
                                <span>Cambio a entregar:</span>
                                <span>{formatCurrency(changeMultiple)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Opción para incluir propina */}
                      {orderData && orderData.tip > 0 && (
                          <div className="flex items-center justify-between space-x-2 p-3 rounded-md border">
                            <Label htmlFor="includeTip" className="cursor-pointer">
                              Incluir propina en el pago
                            </Label>
                            <Switch id="includeTip" checked={includeTip} onCheckedChange={setIncludeTip} />
                          </div>
                      )}

                      {/* Mostrar mensaje de error de forma elegante */}
                      {error && <p className="text-sm text-destructive">{error}</p>}

                    </div>
                  </div>

                </div>

              </div>


              <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                {paymentMethods.map((method) => (
                    <div key={method} className="rounded-md border hover:bg-muted space-y-2">
                      <button
                          type="button"
                          onClick={() => setSelectedMethod(method === selectedMethod ? null : method)}
                          className={cn(
                              "flex items-center w-full text-left cursor-pointer border rounded-md p-3 transition-all duration-200",
                              selectedMethod === method
                                  ? "bg-primary/10 border-primary ring-2 ring-primary"
                                  : "hover:bg-muted"
                          )}
                      >
                        {paymentIcons[method]}
                        <span className="flex-1">{paymentLabels[method]}</span>

                        <div className="h-12 flex items-center justify-end text-xl font-mono border rounded-md bg-muted/20 px-3">
                          {paymentAmounts[method] ? formatCurrency(Number(paymentAmounts[method])) : formatCurrency(0)}
                        </div>
                      </button>
                    </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPaymentConfirmation(false)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
              </Button>
              <Button
                onClick={handlePaymentConfirmationSubmit}
                disabled={confirmDisabled}
                variant={totalPaid > finalAmount ? "destructive" : "default"}
              >
                <Check className="mr-2 h-4 w-4" />
                Confirmar Pago
              </Button>
            </DialogFooter>
          </DialogContent>

        </Dialog>
    )
  }

  // Si estamos mostrando la factura, mostrar la vista de impresión con botón de confirmar
  if (showInvoice && invoiceData) {
    return (
      <InvoicePrintView
        invoice={invoiceData}
        open={showInvoice}
        onOpenChange={(open) => {
          setShowInvoice(open)
          if (!open) {
            onOpenChange(false) // Cerrar también el diálogo principal si se cierra la factura
          }
        }}
        onConfirmPayment={handleConfirmPayment}
        onUndoPartialPayment={isPartialPayment ? handleUndoPartialPayment : undefined}
        isPartialPayment={isPartialPayment}
        isPending={true}
      />
    )
  }

  // Pantalla principal de selección de método de pago
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Método de Pago</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => handleGenerateInvoice(e)}>
          <div className="py-4 space-y-6">
            <div className="flex justify-between font-bold text-lg">
              <span>Total a Pagar:</span>
              <span>{formatCurrency(isPartialPayment ? amount : tableTotal)}</span>
            </div>

            <RadioGroup value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
              <div className="flex flex-col space-y-3">
                <div className="flex items-center space-x-2 rounded-md border p-3 cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="cash" id="cash" />
                  <Label htmlFor="cash" className="flex items-center cursor-pointer flex-1">
                    <Banknote className="mr-2 h-5 w-5" />
                    Efectivo
                  </Label>
                </div>

                <div className="flex items-center space-x-2 rounded-md border p-3 cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="transfer" id="transfer" />
                  <Label htmlFor="transfer" className="flex items-center cursor-pointer flex-1">
                    <CreditCard className="mr-2 h-5 w-5" />
                    Transferencia Bancaria
                  </Label>
                </div>

                <div className="flex items-center space-x-2 rounded-md border p-3 cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="nequi" id="nequi" />
                  <Label htmlFor="nequi" className="flex items-center cursor-pointer flex-1">
                    <Smartphone className="mr-2 h-5 w-5" />
                    Nequi
                  </Label>
                </div>

                <div className="flex items-center space-x-2 rounded-md border p-3 cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="bancolombia" id="bancolombia" />
                  <Label htmlFor="bancolombia" className="flex items-center cursor-pointer flex-1">
                    <Smartphone className="mr-2 h-5 w-5" />
                    Bancolombia App
                  </Label>
                </div>

                <div className="flex items-center space-x-2 rounded-md border p-3 cursor-pointer hover:bg-muted">
                  <RadioGroupItem value="multiple" id="multiple" />
                  <Label htmlFor="multiple" className="flex items-center cursor-pointer flex-1">
                    <PlusCircle className="mr-2 h-5 w-5" />
                    Múltiple
                  </Label>
                </div>
              </div>
            </RadioGroup>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit">
              <Printer className="mr-2 h-4 w-4" />
              Generar Factura
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
