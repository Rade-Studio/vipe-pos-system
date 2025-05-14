"use client"

import { useState } from "react"
import {X, Trash2, Send, ShoppingCart, Percent, Minus, Plus} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { CartItem } from "@/types"
import { formatCurrency } from "@/utils/helpers"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog"
import { Slider } from "../ui/slider"
import { useConfigStore } from "@/store/use-config-store"
import {usePOSStore} from "@/store/use-pos-store";

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
  hasActiveTable: boolean
  isMobile?: boolean
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
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
  hasActiveTable,
  isMobile = false,
  isOpen = true,
  onOpenChange,
}: CartSidebarProps) {
  const [editingComments, setEditingComments] = useState<Record<string, string>>({})
  const [showTipDialog, setShowTipDialog] = useState(false)
  const { tipPercentage, taxPercentage, setTipPercentage } = useConfigStore()
  const { calculateOrderBill } = usePOSStore()

  const bill = calculateOrderBill(cartItems, tipPercentage, taxPercentage)

  const handleCommentsChange = (itemId: string, value: string) => {
    setEditingComments((prev) => ({
      ...prev,
      [itemId]: value,
    }))
  }

  const handleCommentsSave = (itemId: string) => {
    const comments = editingComments[itemId] || ""
    onUpdateComments(itemId, comments)
    setEditingComments((prev) => {
      const newState = { ...prev }
      delete newState[itemId]
      return newState
    })
  }

  const handleCommentsCancel = (itemId: string) => {
    setEditingComments((prev) => {
      const newState = { ...prev }
      delete newState[itemId]
      return newState
    })
  }

  const handleTipChange = (value: number[]) => {
    setTipPercentage(value[0])
  }

  const startEditingComments = (itemId: string, currentComments = "") => {
    setEditingComments((prev) => ({
      ...prev,
      [itemId]: currentComments,
    }))
  }

  const cartContent = (
    <>
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <h2 className="text-lg font-semibold">{tableNumber ? `Mesa ${tableNumber}` : "Carrito"}</h2>
          {cartItems.length > 0 && (
            <Badge variant="outline" className="ml-2">
              {cartItems.length} {cartItems.length === 1 ? "producto" : "productos"}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {cartItems.length > 0 && (
            <Button variant="outline" size="icon" onClick={onClearCart} className="h-8 w-8" title="Vaciar carrito">
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Vaciar carrito</span>
            </Button>
          )}
          {isMobile && (
            <Button variant="outline" size="icon" onClick={() => onOpenChange?.(false)} className="h-8 w-8 md:hidden">
              <X className="h-4 w-4" />
              <span className="sr-only">Cerrar</span>
            </Button>
          )}
        </div>
      </div>

      <Separator className="my-2" />

      {cartItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[50vh] text-muted-foreground">
          <ShoppingCart className="h-12 w-12 mb-2 opacity-20" />
          <p className="text-sm">El carrito está vacío</p>
          {!hasActiveTable && (
            <p className="text-xs mt-1 text-center">Selecciona una mesa para comenzar a agregar productos</p>
          )}
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 pr-4" style={{ height: "calc(100vh - 340px)" }}>
            <div className="space-y-4 mt-4">
              {cartItems.map((item) => (
                <div key={item.id} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onUpdateQuantity(item.id, -1)}
                        disabled={item.quantity < 1}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onUpdateQuantity(item.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Comentarios */}
                  {editingComments[item.id] !== undefined ? (
                    <div className="mt-2">
                      <textarea
                        className="w-full text-sm p-2 border rounded-md"
                        value={editingComments[item.id]}
                        onChange={(e) => handleCommentsChange(item.id, e.target.value)}
                        placeholder="Agregar comentarios..."
                        rows={2}
                      />
                      <div className="flex justify-end gap-2 mt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleCommentsCancel(item.id)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleCommentsSave(item.id)}
                        >
                          Guardar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1">
                      {item.comments ? (
                        <div
                          className="text-xs text-muted-foreground bg-background/50 p-1.5 rounded cursor-pointer"
                          onClick={() => startEditingComments(item.id, item.comments)}
                        >
                          {item.comments}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full h-7 text-xs justify-start text-muted-foreground"
                          onClick={() => startEditingComments(item.id)}
                        >
                          + Agregar comentarios
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-2 text-sm font-medium">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(item.price * item.quantity)}</span>
                  </div>
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
    </>
  )

  // Si es móvil, renderizamos como un Sheet (modal)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md p-4">
          <SheetHeader className="text-left">
            <SheetTitle>Carrito</SheetTitle>
          </SheetHeader>
          {cartContent}
        </SheetContent>
      </Sheet>
    )
  }



  // Si no es móvil, renderizamos como sidebar normal
  return <div className="h-full p-4 flex flex-col">{cartContent}</div>
}
