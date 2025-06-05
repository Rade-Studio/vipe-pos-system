"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock } from "lucide-react"
import type { Order, Profile, Table } from "@/types"
import { formatCurrency } from "@/utils/helpers"

interface ConfirmOrderCardProps {
  order: Order
  waiter?: Profile
  table?: Table
  onConfirm: () => void
  onCancel: () => void
}

interface GroupedItem {
  name: string
  quantity: number
  comments?: string
}

export function ConfirmOrderCard({ order, waiter, table, onConfirm, onCancel }: ConfirmOrderCardProps) {
  const groupedItems = order.items.reduce((acc: Record<string, GroupedItem>, item) => {
    const key = `${item.name}|${item.comments || ""}`
    if (!acc[key]) {
      acc[key] = { name: item.name, quantity: 0, comments: item.comments }
    }
    acc[key].quantity += item.quantity
    return acc
  }, {})

  const time = new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <MapPin className="h-4 w-4 text-red-500 mr-1" /> Mesa {table?.number || "?"}
          </span>
          <span className="text-sm text-muted-foreground">{formatCurrency(order.bill.total)}</span>
        </CardTitle>
        <div className="flex items-center text-sm text-muted-foreground mt-1">
          <Clock className="h-3 w-3 mr-1" /> {time}
          <span className="mx-2">•</span>
          {waiter?.name || "Mesero"}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {Object.values(groupedItems).map((item, idx) => (
          <div key={idx} className="flex justify-between">
            <div>
              <span className="font-medium">{item.quantity}x {item.name}</span>
              {item.comments && (
                <span className="ml-2 text-xs italic text-muted-foreground">{item.comments}</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancel}>Rechazar</Button>
        <Button onClick={onConfirm}>Confirmar</Button>
      </CardFooter>
    </Card>
  )
}

