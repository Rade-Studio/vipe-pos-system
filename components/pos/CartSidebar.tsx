"use client"

import { useState } from "react"
import { ShoppingCart, Minus, Plus, Send, Percent, TableIcon, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { useConfigStore } from "@/store/use-config-store"
import { usePOSStore } from "@/store/use-pos-store"
import type { CartItem } from "@/types"
import { formatCurrency } from "@/utils/helpers"

interface CartSidebarProps {
  tableNumber?: number
  cartItems: CartItem[]
  cartTotal: number
  onUpdateQuantity: (itemId: string, change: number) => void
  onUpdateComments: (itemId: string, comments: string) => void
  onClearCart: () => void
  onSendToKitchen: () => void
  onToggleSidebar: () => void
  isSending: boolean
  hasActiveTable?: boolean
}

export function CartSidebar({
  tableNumber,
  cartItems,
  cartTotal,
  onUpdateQuantity,
  onUpdateComments,
  onClearCart,
  onSendToKitchen,
  onToggleSidebar,
  isSending,
  hasActiveTable = false,
}: CartSidebarProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [itemComments, setItemComments] = useState<string>("")
  const [showTipDialog, setShowTipDialog] = useState(false)
  const { tipPercentage, taxPercentage, setTipPercentage } = useConfigStore()
  const { calculateOrderBill } = usePOSStore()

  // Calcular el desglose del total
  const bill = calculateOrderBill(cartItems, tipPercentage, taxPercentage)

  const handleEditComments = (item: CartItem) => {
    setEditingItemId(item.id)
    setItemComments(item.comments || "")
  }

  const handleSaveComments = () => {
    if (editingItemId) {
      onUpdateComments(editingItemId, itemComments)
      setEditingItemId(null)
      setItemComments("")
    }
  }

  const handleCancelEdit = () => {
    setEditingItemId(null)
    setItemComments("")
  }

  const handleTipChange = (value: number[]) => {
    setTipPercentage(value[0])
  }

  // Renderizar mensaje cuando no hay mesa seleccionada
  if (!hasActiveTable) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center">
            <ShoppingCart className="mr-2 h-5 w-5" />
            <h2 className="text-lg font-semibold">Carrito</h2>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <TableIcon className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-center text-muted-foreground">No hay mesa seleccionada</p>
          <p className="text-center text-sm text-muted-foreground mt-2">
            Seleccione una mesa para comenzar a agregar productos al carrito
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center">
          <ShoppingCart className="mr-2 h-5 w-5" />
          <h2 className="text-lg font-semibold">Carrito {tableNumber ? `- Mesa ${tableNumber}` : ""}</h2>
        </div>
      </div>

      {cartItems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <ShoppingCart className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-center text-muted-foreground">El carrito está vacío</p>
          <p className="text-center text-sm text-muted-foreground">Seleccione productos para agregarlos al carrito</p>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1">
            <div className="p-4">
              {cartItems.map((item) => (
                <div key={item.id} className="mb-4 rounded-lg border p-3">
                  <div className="flex justify-between">
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <h3 className="font-medium">{item.name}</h3>
                        <span className="font-semibold">{formatCurrency(item.price * item.quantity)}</span>
                      </div>
                      {item.originalPrice && item.originalPrice > item.price && (
                        <div className="mt-1 flex justify-between text-xs">
                          <div className="flex items-center">
                            <Tag className="h-3 w-3 mr-1 text-red-500" />
                            <span className="text-red-500">{item.promotionName || "Promoción"}</span>
                          </div>
                          <span className="text-muted-foreground line-through">
                            {formatCurrency(item.originalPrice * item.quantity)}
                          </span>
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onUpdateQuantity(item.id, -1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="mx-2 min-w-8 text-center">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onUpdateQuantity(item.id, 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <span className="text-sm text-muted-foreground">{formatCurrency(item.price)} c/u</span>
                      </div>
                    </div>
                  </div>

                  {editingItemId === item.id ? (
                    <div className="mt-2">
                      <Textarea
                        placeholder="Agregar comentarios (ej. sin cebolla, término medio, etc.)"
                        value={itemComments}
                        onChange={(e) => setItemComments(e.target.value)}
                        className="mb-2 h-20 resize-none"
                      />
                      <div className="flex justify-end space-x-2">
                        <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={handleSaveComments}>
                          Guardar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {item.comments && (
                        <div className="mt-2">
                          <Badge variant="outline" className="font-normal">
                            {item.comments}
                          </Badge>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 h-auto p-0 text-xs text-muted-foreground"
                        onClick={() => handleEditComments(item)}
                      >
                        {item.comments ? "Editar comentarios" : "Agregar comentarios"}
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t p-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal:</span>
                <span>{formatCurrency(bill.subtotal)}</span>
              </div>
              {bill.totalDiscounts > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Descuentos:</span>
                  <span className="text-red-600">-{formatCurrency(bill.totalDiscounts)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Impuesto ({bill.taxPercentage}%):</span>
                <span>{formatCurrency(bill.tax)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="flex items-center text-muted-foreground">
                  Propina ({bill.tipPercentage}%):
                  <Button variant="ghost" size="icon" className="ml-1 h-5 w-5" onClick={() => setShowTipDialog(true)}>
                    <Percent className="h-3 w-3" />
                  </Button>
                </span>
                <span>{formatCurrency(bill.tip)}</span>
              </div>
              <Separator className="my-2" />
              <div className="flex justify-between font-medium">
                <span>Total:</span>
                <span>{formatCurrency(bill.total)}</span>
              </div>
            </div>

            <div className="mt-4 flex space-x-2">
              <Button variant="outline" className="flex-1" onClick={onClearCart}>
                Limpiar
              </Button>
              <Button className="flex-1" onClick={onSendToKitchen} disabled={cartItems.length === 0 || isSending}>
                {isSending ? (
                  "Enviando..."
                ) : (
                  <>
                    Enviar <Send className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Diálogo para ajustar la propina */}
      <Dialog open={showTipDialog} onOpenChange={setShowTipDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar propina</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="mb-6">
              <div className="flex justify-between mb-2">
                <span>Porcentaje de propina:</span>
                <span className="font-semibold">{tipPercentage}%</span>
              </div>
              <Slider value={[tipPercentage]} min={0} max={25} step={1} onValueChange={handleTipChange} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal:</span>
                <span>{formatCurrency(bill.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Propina ({tipPercentage}%):</span>
                <span>{formatCurrency(bill.subtotal * (tipPercentage / 100))}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowTipDialog(false)}>Aceptar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
