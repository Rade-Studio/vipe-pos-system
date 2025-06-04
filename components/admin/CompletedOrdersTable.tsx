"use client"

import { useState, useEffect, useMemo } from "react"
import DataTable, { TableColumn } from "react-data-table-component"
import { Button } from "@/components/ui/button"
import { Printer, RefreshCw } from "lucide-react"
import {formatCurrency, formatDateTime} from "@/utils/helpers"
import { usePOSStore } from "@/store/use-pos-store"
import { InvoicePrintView } from "@/components/printing/InvoicePrintView"
import type { Order, Table, Profile, PrintableInvoice } from "@/types"
import { useConfigStore } from "@/store/use-config-store"
import { format } from "date-fns"
import { getOrdersByDate } from "@/lib/supabase/service"
import { useToast } from "@/components/ui/use-toast"

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
  const [searchTerm, setSearchTerm] = useState("")

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
  const allOrders = useMemo(() => {
    const combinedOrders = [...localCompletedOrders]

    // Agregar órdenes de la base de datos que no estén ya en el estado local
    dbOrders.forEach((dbOrder) => {
      if (!combinedOrders.some((order) => order.id === dbOrder.id)) {
        combinedOrders.push(dbOrder)
      }
    })

    // Ordenar por fecha, más reciente primero
    return combinedOrders.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })
  }, [localCompletedOrders, dbOrders])

  const completedOrders = useMemo(() => {
    if (!searchTerm) return allOrders

    const lowerSearch = searchTerm.toLowerCase().trim()
    const isNumeric = /^\d+$/.test(lowerSearch)

    // Buscar por ID (contiene el término)
    const byId = allOrders.filter((order: Order) => order.id.toLowerCase().includes(lowerSearch))

    // Buscar por nombre de mesero (contiene el término)
    const byWaiter = allOrders.filter((order: Order) => {
      const waiter = profiles.find((p: any) => p.id === order.waiter)
      return waiter && waiter.name.toLowerCase().includes(lowerSearch)
    })

    // Unir resultados sin duplicados
    const allMatches = [...byId, ...byWaiter]
    const uniqueOrders = Array.from(new Map(allMatches.map((o: Order) => [o.id, o])).values())
    return uniqueOrders
  }, [allOrders, searchTerm, tables, profiles])


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
        totalDiscounts: order.bill?.totalDiscounts || 0,
      },
      waiter: waiter?.name || "Desconocido",
      table: table?.number.toString() || "N/A",
      paymentMethod: "cash", // Por defecto, ya que no tenemos el método real guardado
    }

    setSelectedInvoice(invoice)
    setInvoiceOpen(true)
  }

  const columns: TableColumn<Order>[] = [
    {
      name: "ID",
      selector: (row) => row.id.substring(0, 8),
      sortable: true,
    },
    {
      name: "Fecha",
      selector: (row) => (row.createdAt ? formatDateTime(row.createdAt) : ""),
      sortable: true,
    },
    {
      name: "Mesero",
      selector: (row) => {
        const waiter = profiles.find((p) => p.id === row.waiter)
        return waiter ? waiter.name : "Desconocido"
      },
      sortable: true,
    },
    {
      name: "Total",
      selector: (row) => row.bill?.total || 0,
      sortable: true,
      right: true,
      format: (row) => formatCurrency(row.bill?.total || 0),
    },
    {
      name: "Acciones",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => handlePrintInvoice(row)}>
          <Printer className="h-4 w-4 mr-1" />
          Factura
        </Button>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
      right: true,
    },
  ]

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

      <div className="flex items-center mb-4">
        <input
          type="text"
          placeholder="Buscar por ID o mesero..."
          className="px-3 py-2 border rounded-md w-full max-w-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        data={completedOrders}
        progressPending={isLoading}
        pagination
        paginationPerPage={10}
        paginationRowsPerPageOptions={[10, 25, 50, 100]}
        noDataComponent={
          <div className="py-4 text-muted-foreground text-center">
            {searchTerm
              ? "No se encontraron órdenes con ese término de búsqueda"
              : `No hay órdenes completadas ${selectedDate ? "para esta fecha" : ""}`}
          </div>
        }
      />

      {selectedInvoice && (
        <InvoicePrintView invoice={selectedInvoice} open={invoiceOpen} onOpenChange={setInvoiceOpen} />
      )}
    </div>
  )
}
