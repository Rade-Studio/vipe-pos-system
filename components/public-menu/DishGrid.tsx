"use client"

import Image from "next/image"
import type { Dish } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/utils/helpers"

interface DishGridProps {
  dishes: Dish[]
  onAdd?: (dish: Dish) => void
  showAddButton?: boolean
}

export default function DishGrid({ dishes, onAdd, showAddButton }: DishGridProps) {
  if (dishes.length === 0) {
    return <p className="text-center text-muted-foreground py-10">No hay productos disponibles</p>
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {dishes.map((d) => (
        <Card key={d.id} className="overflow-hidden">
          <CardContent className="p-4 flex flex-col items-center text-center space-y-2">
            <Image src={d.image || "/placeholder.svg?height=80&width=80"} alt={d.name} width={80} height={80} className="rounded-md object-cover" />
            <div className="space-y-1">
              <p className="font-medium">{d.name}</p>
              <p className="text-sm text-muted-foreground">{formatCurrency(d.price)}</p>
            </div>
            {showAddButton && onAdd && (
              <Button size="sm" onClick={() => onAdd(d)}>Agregar</Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
