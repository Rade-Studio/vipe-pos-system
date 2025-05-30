"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type {Order, OrderByStatusWithAllData, Profile, Table} from "@/types"
import { formatCurrency } from "@/utils/helpers"
import { AlertCircle, CheckCircle2, ClipboardEdit, Trash2, User, MapPin } from "lucide-react"
import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface OrderCardProps {
  order: OrderByStatusWithAllData
  waiter?: Profile
  table?: Table
  onEdit?: (orderId: string) => void
  onDelete?: (orderId: string) => void
  onMarkAsDelivered?: (itemId: string) => void
  onMarkAllAsDelivered?: (orderId: string) => void
  onPay?: (orderId: string) => void
  onPartialPayment?: (orderId: string) => void
  isKitchenView?: boolean
  isWaiterView?: boolean
  isPaid?: boolean
  showActions?: boolean
  newItems?: string[] // IDs de los nuevos items agregados
}

export function OrderCard({
  order,
  waiter,
  table,
  onEdit,
  onDelete,
  onMarkAsDelivered,
  onMarkAllAsDelivered,
  onPay,
  onPartialPayment,
  isKitchenView = false,
  isWaiterView = false,
  isPaid = false,
  showActions = true,
  newItems = [],
}: OrderCardProps) {
  const [loading, setLoading] = useState(false)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)

  // Estado de la orden (traducido)
  const orderStatus = {
    active: "Activa",
    cancelled: "Cancelada",
    paid: "Pagada",
    kitchen: "En cocina",
    delivered: "Entregada",
    served: "Servida",
  }

  // Manejador de entrega de item individual
  const handleMarkAsDelivered = async (itemId: string) => {
    if (!onMarkAsDelivered) return
    setLoading(true)
    try {
      await onMarkAsDelivered(itemId)
    } catch (error) {
      console.error("Error al marcar el item como entregado:", error)
    } finally {
      setLoading(false)
    }
  }

  // Manejador de entrega de todos los items
  const handleMarkAllAsDelivered = async () => {
    if (!onMarkAllAsDelivered) return
    setLoading(true)
    try {
      await onMarkAllAsDelivered(order.id)
      setShowCompleteDialog(false)
    } catch (error) {
      console.error("Error al marcar todos los items como entregados:", error)
    } finally {
      setLoading(false)
    }
  }

  // Manejador de borrado
  const handleDelete = async () => {
    if (!onDelete) return
    setLoading(true)
    try {
      await onDelete(order.id)
    } catch (error) {
      console.error("Error al eliminar la orden:", error)
    } finally {
      setLoading(false)
    }
  }

  // Fecha localizada
  const localDate = new Date(order.created_at).toLocaleString()

  // Agrupar items idénticos (mismo nombre y comentarios)
  const groupedItems = order.order_items.reduce((acc: any, item) => {
    // Crear una clave única basada en nombre y comentarios
    const key = `${item.name}|${item.comments || ""}`

    if (!acc[key]) {
      acc[key] = {
        ...item,
        quantity: 0,
        ids: [], // Guardar todos los IDs para poder marcar como entregados individualmente
      }
    }

    acc[key].quantity += item.quantity
    acc[key].ids.push(item.id)

    return acc
  }, {})

  // Convertir el objeto agrupado a un array para renderizar
  const groupedItemsArray = Object.values(groupedItems)

  return (
    <Card className={`mb-4 ${newItems.length > 0 && isKitchenView ? "border-yellow-500 border-2" : ""}`}>
      {newItems.length > 0 && isKitchenView && (
        <div className="bg-yellow-100 text-yellow-800 px-4 py-2 flex items-center">
          <AlertCircle className="h-4 w-4 mr-2" />
          <span className="font-medium">¡Nuevos productos agregados!</span>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg flex items-center">
              {isKitchenView && (
                <>
                  <div className="flex items-center bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-lg mr-2">
                    <MapPin className="h-4 w-4 mr-1 text-red-500" />
                    <span className="font-bold">Mesa {table?.number || "?"}</span>
                  </div>
                  <Badge variant="outline" className="ml-2">
                    {order.order_items.length} item(s)
                  </Badge>
                </>
              )}
              {isWaiterView && <>Mesa {table?.number || "?"}</>}
              {!isKitchenView && !isWaiterView && <>Orden {order.id.slice(0, 8)}</>}
            </CardTitle>

            {isKitchenView && (
              <div className="flex items-center mt-2 text-sm text-muted-foreground">
                <User className="h-4 w-4 mr-1 text-blue-500" />
                <span className="font-medium">{waiter?.name || "Mesero no asignado"}</span>
                <span className="mx-2">•</span>
                <span>{localDate}</span>
              </div>
            )}

            {!isKitchenView && (
              <p className="text-sm text-muted-foreground">
                {isWaiterView ? (
                  <>
                    Mesero: {waiter?.name || "No asignado"} - {localDate}
                  </>
                ) : (
                  <>{localDate}</>
                )}
              </p>
            )}
          </div>
          <Badge
            variant={
              order.status === "active" && isKitchenView
                ? "destructive"
                : order.status === "paid" || order.status === "delivered" || order.status === "served"
                  ? "default"
                  : "secondary"
            }
            className="text-sm"
          >
            {orderStatus[order.status] || order.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pb-2">
        {/* Items agrupados */}
        <div className="space-y-3 mt-2">
          {groupedItemsArray.map((item: any, index) => {
            const isAnyItemNew = item.ids.some((id) => newItems.includes(id))

            return (
              <div
                key={index}
                className={`p-3 rounded-md ${isAnyItemNew && isKitchenView ? "bg-yellow-50 border-l-4 border-yellow-500" : "bg-gray-50 dark:bg-gray-800"}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <div className="font-medium flex items-center text-lg">
                      {isAnyItemNew && isKitchenView && (
                        <Badge variant="outline" className="mr-2 bg-yellow-100 text-yellow-800 border-yellow-500">
                          NUEVO
                        </Badge>
                      )}
                      <span className="font-bold text-xl mr-2">{item.quantity}x</span> {item.name}
                    </div>
                    {item.comments && (
                      <div className="text-sm text-muted-foreground mt-1 bg-white dark:bg-gray-700 p-2 rounded border border-gray-200 dark:border-gray-600">
                        <span className="font-medium">Nota:</span> {item.comments}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!isKitchenView && !isWaiterView && <span>{formatCurrency(item.price * item.quantity)}</span>}
                    {isKitchenView && showActions && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMarkAsDelivered(item.ids[0])} // Marcar solo el primer ID
                        disabled={loading}
                        className="whitespace-nowrap"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Entregar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!isKitchenView && !isWaiterView && (
          <>
            <Separator className="my-2" />
            {/* Totales */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(order.bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Impuesto ({order.bill.taxPercentage}%):</span>
                <span>{formatCurrency(order.bill.tax)}</span>
              </div>
              <div className="flex justify-between">
                <span>Propina ({order.bill.tipPercentage}%):</span>
                <span>{formatCurrency(order.bill.tip)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Total:</span>
                <span>{formatCurrency(order.bill.total)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <CardFooter>
        {showActions && (
          <div className="flex justify-end w-full gap-2">
            {isKitchenView && onMarkAllAsDelivered && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShowCompleteDialog(true)}
                  disabled={loading}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Entregar Orden Completa
                </Button>

                <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Entregar toda la orden?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Todos los productos de esta orden serán marcados como entregados.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleMarkAllAsDelivered} className="bg-green-600 hover:bg-green-700">
                        Entregar Todo
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            {!isKitchenView && !isPaid && !isWaiterView && (
              <>
                {onEdit && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(order.id)}>
                    <ClipboardEdit className="h-4 w-4 mr-1" /> Editar
                  </Button>
                )}
                {onDelete && (
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={loading}>
                    <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                  </Button>
                )}
                {onPay && (
                  <Button size="sm" onClick={() => onPay(order.id)} disabled={loading}>
                    Pagar
                  </Button>
                )}
                {onPartialPayment && (
                  <Button variant="outline" size="sm" onClick={() => onPartialPayment(order.id)} disabled={loading}>
                    Pago Parcial
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
