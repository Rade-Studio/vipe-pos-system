"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock, AlertTriangle } from "lucide-react"
import type { Order, Profile, Table } from "@/types"
import { formatCurrency } from "@/utils/helpers"

interface ConfirmOrderCardProps {
  order: Order
  waiter?: Profile
  table?: Table
  hasStockIssue?: boolean
  onConfirmItem: (itemId: string) => void
  onCancelOrder: () => void
}


export function ConfirmOrderCard({ order, waiter, table, hasStockIssue, onConfirmItem, onCancelOrder }: ConfirmOrderCardProps) {

  const time = new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center">
            <MapPin className="h-4 w-4 text-red-500 mr-1" /> Mesa {table?.number || "?"}
          </span>
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            {formatCurrency(order.bill.total)}
            {hasStockIssue && <AlertTriangle className="h-4 w-4 text-amber-600" />}
          </span>
        </CardTitle>
        <div className="flex items-center text-sm text-muted-foreground mt-1">
          <Clock className="h-3 w-3 mr-1" /> {time}
          <span className="mx-2">•</span>
          {waiter?.name || "Mesero"}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {order.items
          .filter((i) => i.status === "pending")
          .map((item) => (
            <div key={item.id} className="flex justify-between items-center">
              <div>
                <span className="font-medium">
                  {item.quantity}x {item.name}
                </span>
                {item.comments && (
                  <span className="ml-2 text-xs italic text-muted-foreground">
                    {item.comments}
                  </span>
                )}
              </div>
              <Button size="sm" onClick={() => onConfirmItem(item.id)}>
                Confirmar
              </Button>
            </div>
          ))}
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onCancelOrder}>Cancelar orden</Button>
      </CardFooter>
    </Card>
  )
}

