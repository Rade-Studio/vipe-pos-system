"use client"

import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/utils/helpers"
import { format } from "date-fns"
import { toast } from "@/utils/toast"
import { realtimeService } from "@/lib/services/realtime/realtime.service"
import { Printer, Check, X, ArrowLeft, Receipt, Tag } from "lucide-react"
import type { PrintableInvoice } from "@/types"

interface InvoicePrintViewProps {
  invoice: PrintableInvoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmPayment?: () => void
  onUndoPartialPayment?: () => void
  isPartialPayment?: boolean
  isPending?: boolean
}

export function InvoicePrintView({
  invoice,
  open,
  onOpenChange,
  onConfirmPayment,
  onUndoPartialPayment,
  isPartialPayment = false,
  isPending = false,
}: InvoicePrintViewProps) {
  const [isOpen, setIsOpen] = useState(open)
  const [isPrinting, setIsPrinting] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIsOpen(open)
  }, [open])

  useEffect(() => {
    // Log para verificar que los datos del mesero y la mesa se están recibiendo correctamente
    console.log("InvoicePrintView recibió:", {
      waiter: invoice?.waiter,
      table: invoice?.table,
      items: invoice?.items?.length,
      bill: invoice?.bill,
      isPending,
    })
  }, [invoice, isPending])

  const handlePrint = () => {
    if (!printRef.current) return

    try {
      setIsPrinting(true)
      realtimeService.sendFactura(invoiceNumber, invoice, displayItems)
      toast.success("Imprimiendo factura...")

      setTimeout(() => {
        setIsPrinting(false)
      }, 2000)

    } catch (error) {
      toast.error("Error al imprimir la factura")
    }
  }

  if (!invoice) {
    return null
  }

  const { invoiceNumber, date, businessInfo, items, bill, waiter, table, paymentMethod } = invoice

  console.log("Renderizando factura con datos:", {
    waiter,
    table,
    items: items?.length || 0,
    paymentMethod,
    bill,
    isPending,
  })

  const getPaymentMethodName = (method: string) => {
    switch (method) {
      case "cash":
        return "Efectivo"
      case "transfer":
        return "Transferencia"
      case "nequi":
        return "Nequi"
      case "bancolombia":
        return "Bancolombia App"
      default:
        return method
    }
  }

  // Calcular el total sin propina
  const totalSinPropina = (bill?.subtotal || 0) + (bill?.tax || 0)

  // Asegurarse de que siempre tengamos valores válidos para mostrar
  const displayWaiter = waiter || "No asignado"
  const displayTable = table || "N/A"

  // Agrupar items por nombre y comentario
  const groupedItems: Record<string, (typeof invoice.items)[0]> = {}
  invoice.items.forEach((item) => {
    const key = `${item.name}-${item.comments || ""}`
    if (!groupedItems[key]) {
      groupedItems[key] = { ...item }
    } else {
      groupedItems[key].quantity += item.quantity
    }
  })
  const displayItems = Object.values(groupedItems)

  // Verificar si hay descuentos
  const hasDiscounts = displayItems.some((item) => item.originalPrice && item.originalPrice > item.price)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(value) => {
        setIsOpen(value)
        onOpenChange(value)
      }}
    >
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-full">
          {/* Lado izquierdo - Vista previa de la factura */}
          <div className="md:w-2/3 border-r dark:border-gray-700 overflow-y-auto max-h-[85vh] md:max-h-[90vh]">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
              <h2 className="text-lg font-semibold">{isPending ? "Vista previa de factura" : "Factura"}</h2>
              {/* Siempre mostrar el botón de imprimir en el encabezado */}
              <Button size="sm" onClick={handlePrint} disabled={isPrinting}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </Button>
            </div>

            <div className="p-6 bg-white dark:bg-gray-900">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 p-6 mx-auto">
                {/* Encabezado */}
                <div className="text-center mb-6">
                  <Receipt className="h-10 w-10 mx-auto mb-2 text-primary" />
                  <h2 className="text-xl font-bold dark:text-white">{businessInfo?.name || "RESTAURANTE"}</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">NIT: {businessInfo?.nit || "N/A"}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{businessInfo?.address || "N/A"}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Tel: {businessInfo?.phone || "N/A"}</p>
                </div>

                {/* Información de la factura */}
                <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                    <span className="font-medium dark:text-white">Factura:</span>
                    <span className="float-right dark:text-gray-300">{invoiceNumber || `INV-${Date.now()}`}</span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                    <span className="font-medium dark:text-white">Fecha:</span>
                    <span className="float-right dark:text-gray-300">{format(date || new Date(), "dd/MM/yyyy")}</span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                    <span className="font-medium dark:text-white">Hora:</span>
                    <span className="float-right dark:text-gray-300">{format(date || new Date(), "HH:mm:ss")}</span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded">
                    <span className="font-medium dark:text-white">Mesa:</span>
                    <span className="float-right dark:text-gray-300">{displayTable}</span>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-2 rounded col-span-2">
                    <span className="font-medium dark:text-white">Mesero:</span>
                    <span className="float-right dark:text-gray-300">{displayWaiter}</span>
                  </div>
                </div>

                {/* Tabla de items */}
                <div className="mb-4">
                  <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-t grid grid-cols-12 font-medium text-sm dark:text-white">
                    <div className="col-span-2">Cant.</div>
                    <div className="col-span-7">Descripción</div>
                    <div className="col-span-3 text-right">Importe</div>
                  </div>
                  <div className="border-x border-b dark:border-gray-700 rounded-b divide-y dark:divide-gray-700">
                    {displayItems && displayItems.length > 0 ? (
                      displayItems.map((item, index) => (
                        <div key={index} className="p-2 grid grid-cols-12 text-sm dark:text-gray-300">
                          <div className="col-span-2">{item.quantity}</div>
                          <div className="col-span-7">
                            <div className="flex items-start">
                              <span>{item.name}</span>
                              {item.originalPrice && item.originalPrice > item.price && (
                                <Tag className="h-3 w-3 ml-1 text-red-500 flex-shrink-0" />
                              )}
                            </div>
                            {item.comments && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">({item.comments})</div>
                            )}
                            {item.originalPrice && item.originalPrice > item.price && item.promotionName && (
                              <div className="text-xs text-red-500 dark:text-red-400 italic">{item.promotionName}</div>
                            )}
                          </div>
                          <div className="col-span-3 text-right">
                            {item.originalPrice && item.originalPrice > item.price ? (
                              <>
                                <div className="line-through text-xs text-gray-500">
                                  {formatCurrency(item.originalPrice * item.quantity)}
                                </div>
                                <div>{formatCurrency(item.price * item.quantity)}</div>
                              </>
                            ) : (
                              formatCurrency(item.price * item.quantity)
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-2 text-sm text-center text-gray-500 dark:text-gray-400">
                        No hay items en esta orden
                      </div>
                    )}
                  </div>
                </div>

                {/* Totales */}
                <div className="space-y-1 mb-4 dark:text-gray-300">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(bill?.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>IVA ({bill?.taxPercentage || 0}%):</span>
                    <span>{formatCurrency(bill?.tax || 0)}</span>
                  </div>
                  {bill?.totalDiscounts > 0 && (
                    <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                      <span>Descuentos:</span>
                      <span>-{formatCurrency(bill?.totalDiscounts || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-medium pt-1 border-t dark:border-gray-700">
                    <span>Total sin propina:</span>
                    <span>{formatCurrency(totalSinPropina)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Propina ({bill?.tipPercentage || 0}%):</span>
                    <span>{formatCurrency(bill?.tip || 0)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold pt-1 border-t dark:border-gray-700 dark:text-white">
                    <span>TOTAL A PAGAR:</span>
                    <span>{formatCurrency(bill?.total || 0)}</span>
                  </div>
                </div>

                {/* Forma de pago */}
                <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg mb-4 dark:text-gray-300">
                  <div className="font-medium">
                    Forma de pago:{" "}
                    <span className="font-bold dark:text-white">{getPaymentMethodName(paymentMethod || "cash")}</span>
                  </div>
                  {invoice.cashReceived && invoice.cashReceived > 0 && (
                    <>
                      <div className="flex justify-between mt-1 text-sm">
                        <span>Efectivo recibido:</span>
                        <span>{formatCurrency(invoice.cashReceived)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Cambio:</span>
                        <span>{formatCurrency(invoice.cashChange || 0)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Pie de página */}
                <div className="text-center text-sm text-gray-600 dark:text-gray-400 border-t dark:border-gray-700 pt-4">
                  <p>RÉGIMEN SIMPLIFICADO</p>
                  <p>RESOLUCIÓN DIAN No. 18764000001</p>
                  <p>DEL 01/01/2023 AL 31/12/2023</p>
                  <p>NUMERACIÓN: 1 AL 1000</p>
                  <p className="font-medium mt-2 dark:text-gray-300">¡Gracias por su compra!</p>
                  <p>Vuelva pronto</p>
                </div>
              </div>
            </div>
          </div>

          {/* Lado derecho - Botones y acciones */}
          <div className="md:w-1/3 flex flex-col">
            <div className="p-6 flex flex-col h-full justify-between">
              <div>
                <h3 className="text-lg font-medium mb-4">Opciones</h3>

                {isPending ? (
                  <div className="space-y-4">
                    <div className="bg-amber-50 dark:bg-amber-950/30 p-4 rounded-lg border border-amber-200 dark:border-amber-900 mb-4">
                      <h4 className="font-medium text-amber-800 dark:text-amber-400 mb-2">Confirmación de pago</h4>
                      <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
                        Verifique los detalles de la factura antes de confirmar el pago.
                      </p>

                      <div className="flex flex-col gap-2">
                        {isPartialPayment && onUndoPartialPayment && (
                          <Button variant="outline" onClick={onUndoPartialPayment} className="w-full">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Deshacer pago parcial
                          </Button>
                        )}
                        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                          <X className="mr-2 h-4 w-4" />
                          Cancelar
                        </Button>
                        <Button onClick={onConfirmPayment} className="w-full">
                          <Check className="mr-2 h-4 w-4" />
                          Confirmar Pago
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border border-blue-200 dark:border-blue-900 mb-4">
                      <h4 className="font-medium text-blue-800 dark:text-blue-400 mb-2">Imprimir factura</h4>
                      <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                        Imprima la factura para entregarla al cliente o guárdela para sus registros.
                      </p>

                      <Button onClick={handlePrint}  disabled={isPrinting} className="w-full">
                        <Printer className="mr-2 h-4 w-4" />
                        Imprimir factura
                      </Button>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h4 className="font-medium mb-2">Detalles del pago</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Método de pago:</span>
                          <span className="font-medium">{getPaymentMethodName(paymentMethod || "cash")}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total:</span>
                          <span className="font-medium">{formatCurrency(bill?.total || 0)}</span>
                        </div>
                        {bill?.totalDiscounts > 0 && (
                          <div className="flex justify-between">
                            <span>Descuentos aplicados:</span>
                            <span className="font-medium text-red-600">
                              -{formatCurrency(bill?.totalDiscounts || 0)}
                            </span>
                          </div>
                        )}
                        {invoice.cashReceived && invoice.cashReceived > 0 && (
                          <>
                            <div className="flex justify-between">
                              <span>Efectivo recibido:</span>
                              <span>{formatCurrency(invoice.cashReceived)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Cambio:</span>
                              <span>{formatCurrency(invoice.cashChange || 0)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-4 flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                  Cerrar
                </Button>
                {/* Siempre mostrar el botón de imprimir en la parte inferior */}
                <Button onClick={handlePrint} disabled={isPrinting} className="w-full">
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
              </div>
            </div>
          </div>

          {/* Contenido oculto para impresión */}
          <div className="hidden" ref={printRef}>
            {/* Ticket de factura para impresora térmica */}
            <div className="ticket font-mono text-sm">
              {/* Encabezado */}
              <div className="center mb-2">
                <div className="text-base font-bold">{businessInfo?.name || "RESTAURANTE"}</div>
                <div>NIT: {businessInfo?.nit || "N/A"}</div>
                <div>{businessInfo?.address || "N/A"}</div>
                <div>Tel: {businessInfo?.phone || "N/A"}</div>
              </div>

              <div className="divider"></div>

              {/* Información de la factura */}
              <div className="mb-2">
                <div className="info-row">
                  <span>FACTURA:</span>
                  <span>{invoiceNumber || `INV-${Date.now()}`}</span>
                </div>
                <div className="info-row">
                  <span>FECHA:</span>
                  <span>{format(date || new Date(), "dd/MM/yyyy")}</span>
                </div>
                <div className="info-row">
                  <span>HORA:</span>
                  <span>{format(date || new Date(), "HH:mm:ss")}</span>
                </div>
                <div className="info-row">
                  <span>MESA:</span>
                  <span>{displayTable}</span>
                </div>
                <div className="info-row">
                  <span>MESERO:</span>
                  <span>{displayWaiter}</span>
                </div>
              </div>

              <div className="divider"></div>

              {/* Encabezado de items */}
              <div className="flex justify-between font-bold mb-1">
                <div style={{ width: "10%" }}>CANT</div>
                <div style={{ width: "60%" }}>DESCRIPCIÓN</div>
                <div style={{ width: "30%" }} className="text-right">
                  IMPORTE
                </div>
              </div>

              {/* Items */}
              <div className="mb-2">
                {displayItems &&
                  displayItems.map((item, index) => (
                    <div key={index} className="flex justify-between mb-1">
                      <div style={{ width: "10%" }}>{item.quantity}</div>
                      <div style={{ width: "60%" }}>
                        {item.name}
                        {item.comments && <div className="text-xs">({item.comments})</div>}
                      </div>
                      <div style={{ width: "30%" }} className="text-right">
                        {item.originalPrice && item.originalPrice > item.price ? (
                          <>
                            <div className="strikethrough">{formatCurrency(item.originalPrice * item.quantity)}</div>
                            <div>{formatCurrency(item.price * item.quantity)}</div>
                          </>
                        ) : (
                          formatCurrency(item.price * item.quantity)
                        )}
                      </div>
                    </div>
                  ))}
              </div>

              <div className="divider"></div>

              {/* Totales */}
              <div className="totals mb-2">
                <div className="info-row">
                  <span>SUBTOTAL:</span>
                  <span>{formatCurrency(bill?.subtotal || 0)}</span>
                </div>
                <div className="info-row">
                  <span>IVA ({bill?.taxPercentage || 0}%):</span>
                  <span>{formatCurrency(bill?.tax || 0)}</span>
                </div>
                {bill?.totalDiscounts > 0 && (
                  <div className="info-row discount">
                    <span>DESCUENTOS:</span>
                    <span>-{formatCurrency(bill?.totalDiscounts || 0)}</span>
                  </div>
                )}
                <div className="info-row font-bold">
                  <span>TOTAL SIN PROPINA:</span>
                  <span>{formatCurrency(totalSinPropina)}</span>
                </div>
                <div className="info-row">
                  <span>PROPINA ({bill?.tipPercentage || 0}%):</span>
                  <span>{formatCurrency(bill?.tip || 0)}</span>
                </div>
                <div className="info-row font-bold text-base">
                  <span>TOTAL A PAGAR:</span>
                  <span>{formatCurrency(bill?.total || 0)}</span>
                </div>
              </div>

              <div className="divider"></div>

              {/* Forma de pago */}
              <div className="mb-2">
                <div className="font-bold">FORMA DE PAGO: {getPaymentMethodName(paymentMethod || "cash")}</div>
                {invoice.cashReceived && invoice.cashReceived > 0 && (
                  <>
                    <div className="info-row">
                      <span>EFECTIVO RECIBIDO:</span>
                      <span>{formatCurrency(invoice.cashReceived)}</span>
                    </div>
                    <div className="info-row">
                      <span>CAMBIO:</span>
                      <span>{formatCurrency(invoice.cashChange || 0)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className="divider"></div>

              {/* Pie de página */}
              <div className="center mb-4">
                <div>RÉGIMEN SIMPLIFICADO</div>
                <div>RESOLUCIÓN DIAN No. 18764000001</div>
                <div>DEL 01/01/2023 AL 31/12/2023</div>
                <div>NUMERACIÓN: 1 AL 1000</div>
                <div className="mt-2">¡GRACIAS POR SU COMPRA!</div>
                <div>VUELVA PRONTO</div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
