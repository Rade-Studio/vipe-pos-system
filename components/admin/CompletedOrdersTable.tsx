"use client"

import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Printer, RefreshCw } from "lucide-react"
import { formatCurrency, formatDate } from "@/utils/helpers"
import { usePOSStore } from "@/store/use-pos-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { Order, PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { format } from "date-fns"
import { getOrdersByDate } from "@/lib/supabase/service"
import { useToast } from "@/components/ui/use-toast"
import { Skeleton } from "@/components/ui/skeleton"

interface CompletedOrdersTableProps {
  selectedDate?: Date
}

export function CompletedOrdersTable({ selectedDate }: CompletedOrdersTableProps) {
  const { orders, tables, profiles } = usePOSStore()
  const { businessName, businessAddress, businessPhone, businessNIT } = useConfigStore()
  const { toast } = useToast()

  const [selectedInvoice, setSelectedInvoice] = useState<PrintableInvoice | null>(null)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [dbOrders, setDbOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Función para cargar órdenes de la base de datos
  const loadOrdersFromDB = async () => {
    if (!selectedDate) return

    setIsLoading(true)
    try {
      const fetchedOrders = await getOrdersByDate(selectedDate)
      setDbOrders(fetchedOrders)
    } catch (error) {
      console.error("Error al cargar órdenes:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar las órdenes de la base de datos",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Cargar órdenes cuando cambia la fecha seleccionada
  useEffect(() => {
    if (selectedDate) {
      loadOrdersFromDB()
    } else {
      setDbOrders([])
    }
  }, [selectedDate])

  // Filtrar órdenes pagadas del estado local
  const localCompletedOrders = orders.filter((order) => {
    if (order.status !== "paid") return false

    if (selectedDate) {
      const orderDate = new Date(order.createdAt)
      return (
        orderDate.getFullYear() === selectedDate.getFullYear() &&
        orderDate.getMonth() === selectedDate.getMonth() &&
        orderDate.getDate() === selectedDate.getDate()
      )
    }

    return true
  })

  // Combinar órdenes locales y de la base de datos, evitando duplicados
  const allOrders = [...localCompletedOrders]

  // Agregar órdenes de la base de datos que no estén ya en el estado local
  dbOrders.forEach((dbOrder) => {
    if (!allOrders.some((order) => order.id === dbOrder.id)) {
      allOrders.push(dbOrder)
    }
  })

  // Ordenar por fecha, más reciente primero
  const completedOrders = allOrders.sort((a, b) => {
    const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return dateB - dateA
  })

  const handlePrintInvoice = (order: Order) => {
    // Encontrar la mesa correspondiente
    const table = tables.find((t) => t.id === order.tableId)
    // Encontrar el mesero correspondiente
    const waiter = profiles.find((p) => p.id === order.waiter)

    if (!table || !waiter) {
      console.error("Mesa o mesero no encontrado para la orden:", order.id)
      toast({
        title: "Advertencia",
        description: "No se encontró información completa de la mesa o mesero para esta orden",
        variant: "warning",
      })
    }

    // Asegurarnos de que tenemos todos los valores necesarios para la factura
    const subtotal = order.subtotal || order.bill?.subtotal || 0
    const tax = order.tax || order.bill?.tax || 0
    const taxPercentage = order.taxPercentage || order.bill?.taxPercentage || 0
    const tip = order.tip || order.bill?.tip || 0
    const tipPercentage = order.tipPercentage || order.bill?.tipPercentage || 0
    const total = order.total || order.bill?.total || 0

    console.log("Datos de la orden para factura:", {
      id: order.id,
      subtotal,
      tax,
      taxPercentage,
      tip,
      tipPercentage,
      total,
      items: order.items?.length || 0,
    })

    // Generar la factura
    const invoice: PrintableInvoice = {
      invoiceNumber: order.id.substring(0, 8),
      date: order.createdAt || new Date(),
      businessInfo: {
        name: businessName,
        address: businessAddress,
        phone: businessPhone,
        nit: businessNIT,
      },
      items: order.items || [],
      bill: {
        subtotal,
        tax,
        taxPercentage,
        tip,
        tipPercentage,
        total,
      },
      waiter: waiter?.name || "Desconocido",
      table: table?.number.toString() || "N/A",
      paymentMethod: "cash", // Por defecto, ya que no tenemos el método real guardado
    }

    setSelectedInvoice(invoice)
    setInvoiceOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Órdenes Completadas</h2>
        <Button variant="outline" size="sm" onClick={loadOrdersFromDB} disabled={isLoading || !selectedDate}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {selectedDate && (
        <div className="text-sm text-muted-foreground">Mostrando órdenes del {format(selectedDate, "dd/MM/yyyy")}</div>
      )}

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Mesa</TableHead>
              <TableHead>Mesero</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              // Mostrar skeletons durante la carga
              Array(5)
                .fill(0)
                .map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-5 w-20 ml-auto" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
            ) : completedOrders.length > 0 ? (
              completedOrders.map((order) => {
                const table = tables.find((t) => t.id === order.tableId)
                const waiter = profiles.find((p) => p.id === order.waiter)
                return (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">{order.id.substring(0, 8)}</TableCell>
                    <TableCell>{order.createdAt ? formatDate(order.createdAt) : "Fecha no disponible"}</TableCell>
                    <TableCell>{table ? table.number : "N/A"}</TableCell>
                    <TableCell>{waiter ? waiter.name : "Desconocido"}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.total || order.bill?.total || 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handlePrintInvoice(order)}>
                        <Printer className="h-4 w-4 mr-1" />
                        Factura
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">
                  No hay órdenes completadas {selectedDate ? "para esta fecha" : ""}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {selectedInvoice && (
        <InvoicePrintView invoice={selectedInvoice} open={invoiceOpen} onOpenChange={setInvoiceOpen} />
      )}
    </div>
  )
}
