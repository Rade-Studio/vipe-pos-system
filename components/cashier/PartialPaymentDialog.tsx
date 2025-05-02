"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatCurrency } from "@/utils/helpers"
import { Plus, Minus } from "lucide-react"
import type { CartItem } from "@/types"
import { useToast } from "@/hooks/use-toast"

interface PartialPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableItems?: CartItem[]
  onCreatePartialOrder: (selectedItems: { itemId: string; quantity: number }[]) => void
}

export function PartialPaymentDialog({
  open,
  onOpenChange,
  tableItems = [],
  onCreatePartialOrder,
}: PartialPaymentDialogProps) {
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const { toast } = useToast()

  // Inicializar las cantidades con los valores de los items
  useEffect(() => {
    if (open && tableItems && tableItems.length > 0) {
      const initialQuantities: Record<string, number> = {}
      tableItems.forEach((item) => {
        initialQuantities[item.id] = item.quantity
      })
      setQuantities(initialQuantities)
      // Limpiar selecciones previas
      setSelectedItems({})
    }
  }, [open, tableItems])

  const handleCheckboxChange = (itemId: string, checked: boolean) => {
    setSelectedItems((prev) => {
      const newSelected = { ...prev }
      if (checked) {
        newSelected[itemId] = quantities[itemId] || 1
      } else {
        delete newSelected[itemId]
      }
      return newSelected
    })
  }

  const handleIncreaseQuantity = (itemId: string) => {
    const item = tableItems?.find((i) => i.id === itemId)
    if (!item) return

    // No permitir cantidades mayores que la cantidad original del item
    const maxQuantity = item.quantity
    const currentQuantity = quantities[itemId] || 1

    if (currentQuantity < maxQuantity) {
      const newQuantity = currentQuantity + 1

      setQuantities((prev) => ({
        ...prev,
        [itemId]: newQuantity,
      }))

      // Si el item está seleccionado, actualizar también la cantidad seleccionada
      if (selectedItems[itemId]) {
        setSelectedItems((prev) => ({
          ...prev,
          [itemId]: newQuantity,
        }))
      }
    }
  }

  const handleDecreaseQuantity = (itemId: string) => {
    const currentQuantity = quantities[itemId] || 1

    if (currentQuantity > 1) {
      const newQuantity = currentQuantity - 1

      setQuantities((prev) => ({
        ...prev,
        [itemId]: newQuantity,
      }))

      // Si el item está seleccionado, actualizar también la cantidad seleccionada
      if (selectedItems[itemId]) {
        setSelectedItems((prev) => ({
          ...prev,
          [itemId]: newQuantity,
        }))
      }
    }
  }

  const handleCreatePartialOrder = () => {
    // Verificar que hay items seleccionados
    if (Object.keys(selectedItems).length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debe seleccionar al menos un producto para el pago parcial",
      })
      return
    }

    // Verificar si solo hay un producto con cantidad 1
    if (Object.keys(selectedItems).length === 1) {
      const itemId = Object.keys(selectedItems)[0]
      const quantity = selectedItems[itemId]

      // Si solo hay un producto seleccionado con cantidad 1, no permitir el pago parcial
      if (quantity === 1 && tableItems.length === 1 && tableItems[0].quantity === 1) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "No se puede hacer pago parcial con un solo producto",
        })
        return
      }
    }

    // Crear array de items seleccionados con sus cantidades
    const selectedItemsArray = Object.entries(selectedItems).map(([itemId, quantity]) => ({
      itemId,
      quantity,
    }))

    // Llamar a la función para crear la orden parcial
    onCreatePartialOrder(selectedItemsArray)
    onOpenChange(false)
  }

  // Calcular el total de los items seleccionados
  const calculateSelectedTotal = () => {
    if (!tableItems) return 0

    return Object.entries(selectedItems).reduce((total, [itemId, quantity]) => {
      const item = tableItems.find((i) => i.id === itemId)
      if (!item) return total
      return total + item.price * quantity
    }, 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pago Parcial</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-4">
            Seleccione los productos que desea incluir en el pago parcial y ajuste las cantidades con los botones + y -.
          </p>

          {tableItems && tableItems.length > 0 ? (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-4">
                {tableItems.map((item) => (
                  <div key={item.id} className="flex flex-col space-y-2 pb-2 border-b">
                    <div className="flex items-start">
                      <Checkbox
                        id={`item-${item.id}`}
                        checked={!!selectedItems[item.id]}
                        onCheckedChange={(checked) => handleCheckboxChange(item.id, !!checked)}
                        className="mt-1"
                      />
                      <div className="ml-2 flex-1">
                        <Label htmlFor={`item-${item.id}`} className="font-medium">
                          {item.name}
                        </Label>
                        <div className="text-sm text-muted-foreground">
                          {formatCurrency(item.price)} c/u × {item.quantity} ={" "}
                          {formatCurrency(item.price * item.quantity)}
                        </div>
                        {item.comments && <div className="text-xs italic">{item.comments}</div>}
                      </div>
                    </div>

                    {selectedItems[item.id] && (
                      <div className="ml-7 mt-2">
                        <Label htmlFor={`quantity-${item.id}`} className="text-sm mb-2 block">
                          Cantidad a pagar:
                        </Label>
                        <div className="flex items-center mt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 w-9 rounded-full p-0 flex items-center justify-center"
                            onClick={() => handleDecreaseQuantity(item.id)}
                            disabled={(quantities[item.id] || 1) <= 1}
                          >
                            <Minus className="h-4 w-4" />
                            <span className="sr-only">Disminuir</span>
                          </Button>

                          <div className="mx-3 min-w-[40px] text-center font-medium">{quantities[item.id] || 1}</div>

                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 w-9 rounded-full p-0 flex items-center justify-center"
                            onClick={() => handleIncreaseQuantity(item.id)}
                            disabled={(quantities[item.id] || 1) >= item.quantity}
                          >
                            <Plus className="h-4 w-4" />
                            <span className="sr-only">Aumentar</span>
                          </Button>

                          <span className="ml-3 text-sm">
                            de {item.quantity} ({formatCurrency(item.price * (quantities[item.id] || 1))})
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">No hay productos disponibles</div>
          )}

          <div className="mt-4 p-3 bg-muted/20 rounded-md">
            <div className="flex justify-between font-bold">
              <span>Total Seleccionado:</span>
              <span>{formatCurrency(calculateSelectedTotal())}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreatePartialOrder} disabled={Object.keys(selectedItems).length === 0}>
            Crear Orden Parcial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
