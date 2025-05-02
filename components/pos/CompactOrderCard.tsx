"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import type { Order, OrderItem, Profile, Table } from "@/types"
import { formatCurrency } from "@/utils/helpers"
import { Clock, MapPin } from "lucide-react"

interface CompactOrderCardProps {
  order: Order
  waiter?: Profile
  table?: Table
}

// Interfaz para los items agrupados
interface GroupedItem {
  name: string
  quantity: number
  comments?: string
  ids: string[] // Mantener los IDs originales para referencia
}

export function CompactOrderCard({ order, waiter, table }: CompactOrderCardProps) {
  // Estado de la orden (traducido)
  const orderStatus = {
    active: "Activa",
    cancelled: "Cancelada",
    paid: "Pagada",
    kitchen: "En cocina",
    delivered: "Entregada",
    served: "Servida",
  }

  // Fecha localizada
  const localTime = new Date(order.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

  // Agrupar items por nombre y comentarios
  const groupItems = (items: OrderItem[]): GroupedItem[] => {
    const groupedMap = new Map<string, GroupedItem>()

    items.forEach((item) => {
      // Crear una clave única basada en nombre y comentarios
      const key = `${item.name}|${item.comments || ""}`

      if (groupedMap.has(key)) {
        // Si ya existe, incrementar la cantidad y añadir el ID
        const existing = groupedMap.get(key)!
        existing.quantity += item.quantity
        existing.ids.push(item.id)
      } else {
        // Si no existe, crear un nuevo grupo
        groupedMap.set(key, {
          name: item.name,
          quantity: item.quantity,
          comments: item.comments,
          ids: [item.id],
        })
      }
    })

    return Array.from(groupedMap.values())
  }

  const groupedItems = groupItems(order.items)

  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div
        className={`h-2 w-full ${
          order.status === "kitchen"
            ? "bg-amber-500"
            : order.status === "delivered"
              ? "bg-green-500"
              : order.status === "served"
                ? "bg-blue-500"
                : "bg-gray-500"
        }`}
      />

      <CardContent className="p-3">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center">
            <MapPin className="h-4 w-4 text-red-500 mr-1" />
            <span className="font-bold text-lg">Mesa {table?.number || "?"}</span>
          </div>
          <Badge
            variant="outline"
            className={`
            ${
              order.status === "kitchen"
                ? "bg-amber-100 text-amber-800 border-amber-300"
                : order.status === "delivered"
                  ? "bg-green-100 text-green-800 border-green-300"
                  : order.status === "served"
                    ? "bg-blue-100 text-blue-800 border-blue-300"
                    : "bg-gray-100 text-gray-800 border-gray-300"
            }
          `}
          >
            {orderStatus[order.status] || order.status}
          </Badge>
        </div>

        <div className="flex justify-between items-center text-sm text-muted-foreground mb-2">
          <div className="flex items-center">
            <Clock className="h-3 w-3 mr-1" />
            {localTime}
          </div>
          <div>
            {groupedItems.length} item{groupedItems.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div className="text-sm space-y-1 max-h-[120px] overflow-y-auto pr-1">
          {groupedItems.map((item, index) => (
            <div key={index} className="flex flex-col">
              <div className="flex justify-between">
                <div className="font-medium">
                  {item.quantity}x {item.name}
                </div>
              </div>
              {item.comments && <div className="text-xs text-muted-foreground ml-4 italic">{item.comments}</div>}
            </div>
          ))}
        </div>

        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="text-xs text-muted-foreground">{waiter?.name || "Sin mesero"}</div>
          <div className="font-medium">{formatCurrency(order.bill.total)}</div>
        </div>
      </CardContent>
    </Card>
  )
}
