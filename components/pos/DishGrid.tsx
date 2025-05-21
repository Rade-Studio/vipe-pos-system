"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ShoppingCart, AlertTriangle, Tag } from "lucide-react"
import type { Dish } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatCurrency } from "@/utils/helpers"
import { useConfigStore } from "@/store/use-config-store"
import inventoryControlService from "@/lib/supabase/inventory-control-service"
import { Skeleton } from "@/components/ui/skeleton"
import {toast} from "@/components/ui/use-toast";

interface DishGridProps {
  dishes: Dish[]
  onAddToCart: (dish: Dish, comments?: string) => void
}

export function DishGrid({ dishes, onAddToCart }: DishGridProps) {
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null)
  const [comments, setComments] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [stockStatus, setStockStatus] = useState<Map<string, boolean>>(new Map())
  const [isLoadingStock, setIsLoadingStock] = useState(false)

  const { inventoryControlEnabled } = useConfigStore()

  // Detectar si es un dispositivo táctil
  useEffect(() => {
    setIsTouchDevice("ontouchstart" in window || navigator.maxTouchPoints > 0)
  }, [])

  // Cargar el estado de stock de los platos si el control de inventario está activado
  useEffect(() => {
    if (inventoryControlEnabled && dishes.length > 0) {
      loadStockStatus()
    }
  }, [inventoryControlEnabled, dishes])

  const loadStockStatus = async () => {
    if (!inventoryControlEnabled) return

    setIsLoadingStock(true)
    try {
      // Verificar el stock solo para los platos mostrados
      const stockPromises = dishes.map(async (dish) => {
        try {
          // Usar checkStockForDish en lugar de checkDishStock
          const hasStock = await inventoryControlService.checkStockForDish(dish.id)
          return [dish.id, hasStock]
        } catch (error) {
          // En caso de error, asumimos que el plato está disponible
          return [dish.id, true]
        }
      })

      const stockResults = await Promise.all(stockPromises)
      const newStockStatus = new Map(stockResults)
      setStockStatus(newStockStatus)
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron verificar los stocks. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setIsLoadingStock(false)
    }
  }

  const handleDishClick = (dish: Dish) => {
    // Si el control de inventario está activado y el plato está agotado, no hacer nada
    // if (inventoryControlEnabled && stockStatus.has(dish.id) && !stockStatus.get(dish.id)) {
    //   return
    // }

    // Click izquierdo: agregar directamente al carrito
    onAddToCart(dish)
  }

  const handleDishRightClick = (e: React.MouseEvent, dish: Dish) => {
    e.preventDefault() // Prevenir el menú contextual del navegador

    // Si el control de inventario está activado y el plato está agotado, no hacer nada
    // if (inventoryControlEnabled && stockStatus.has(dish.id) && !stockStatus.get(dish.id)) {
    //   return
    // }

    setSelectedDish(dish)
    setComments("")
    setDialogOpen(true)
  }

  const handleTouchStart = (dish: Dish) => {
    if (!isTouchDevice) return

    // Si el control de inventario está activado y el plato está agotado, no hacer nada
    // if (inventoryControlEnabled && stockStatus.has(dish.id) && !stockStatus.get(dish.id)) {
    //   return
    // }

    // Iniciar temporizador para detectar pulsación larga
    const timer = setTimeout(() => {
      setSelectedDish(dish)
      setComments("")
      setDialogOpen(true)
      setLongPressTimer(null)
    }, 500) // 500ms para considerar pulsación larga

    setLongPressTimer(timer)
  }

  const handleTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }

  const handleTouchMove = () => {
    // Cancelar la pulsación larga si el usuario mueve el dedo
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }

  const handleAddToCart = () => {
    if (selectedDish) {
      onAddToCart(selectedDish, comments.trim() || undefined)
      setDialogOpen(false)
    }
  }

  // Si no hay dishes, mostrar placeholder
  if (dishes.length === 0) {
    return <div className="text-center py-10 text-muted-foreground">No hay productos disponibles en esta categoría</div>
  }

  // Si está cargando el estado de stock, mostrar Skeletons en lugar del mensaje de texto
  if (inventoryControlEnabled && isLoadingStock) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: dishes.length }).map((_, index) => (
          <Card key={index} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-20 w-20 rounded-md" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-6 w-24 mt-2" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {dishes.map((dish) => {
          // Verificar si el plato está agotado
          const isOutOfStock = inventoryControlEnabled && !stockStatus.get(dish.id)

          return (
            <Card
              key={dish.id}
              className={`overflow-hidden transition-shadow cursor-pointer hover:shadow-md`}
              onClick={() => handleDishClick(dish)}
              onContextMenu={(e) => handleDishRightClick(e, dish)}
              onTouchStart={() => handleTouchStart(dish)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="relative h-20 w-20">
                    <img
                      src={dish.image || "/placeholder.svg"}
                      alt={dish.name}
                      className={`h-20 w-20 object-cover rounded-md ${isOutOfStock ? "grayscale" : ""}`}
                    />
                    {isOutOfStock && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 rounded-md">
                        <Badge variant="destructive" className="absolute top-1 right-1">
                          Agotado
                        </Badge>
                      </div>
                    )}

                    {/* Mostrar badge de promoción si existe */}
                    {dish.discountAmount && dish.discountAmount > 0 && !isOutOfStock && (
                      <Badge className="absolute top-1 right-1 bg-red-500 hover:bg-red-600">
                        <Tag className="h-3 w-3 mr-1" />
                        {dish.discountPercentage ? `-${dish.discountPercentage}%` : formatCurrency(dish.discountAmount)}
                      </Badge>
                    )}
                  </div>
                  <div>
                    <h3 className="font-medium">{dish.name}</h3>

                    {/* Mostrar precio con descuento si existe */}
                    {dish.originalPrice ? (
                      <div>
                        <span className="text-sm line-through text-muted-foreground">
                          {formatCurrency(dish.originalPrice)}
                        </span>
                        <p className="text-red-600 font-medium">{formatCurrency(dish.price)}</p>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">{formatCurrency(dish.price)}</p>
                    )}

                    {isOutOfStock ? (
                      <Badge variant="outline" className="mt-2 bg-red-50 text-red-700 border-red-200">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Agotado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="mt-2">
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        Agregar
                      </Badge>
                    )}

                    {/* Mostrar nombre de la promoción si existe */}
                    {dish.promotionName && <p className="text-xs text-muted-foreground mt-1">{dish.promotionName}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar {selectedDish?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span>Precio:</span>
              <span className="font-bold">
                {selectedDish && selectedDish.originalPrice ? (
                  <>
                    <span className="text-sm line-through text-muted-foreground mr-2">
                      {formatCurrency(selectedDish.originalPrice)}
                    </span>
                    <span className="text-red-600">{formatCurrency(selectedDish.price)}</span>
                  </>
                ) : (
                  selectedDish && formatCurrency(selectedDish.price)
                )}
              </span>
            </div>

            {/* Mostrar información de promoción si existe */}
            {selectedDish && selectedDish.promotionName && (
              <div className="flex items-center justify-between text-sm bg-muted p-2 rounded">
                <span className="flex items-center">
                  <Tag className="h-4 w-4 mr-1 text-red-500" />
                  Promoción:
                </span>
                <span>{selectedDish.promotionName}</span>
              </div>
            )}

            <div>
              <label htmlFor="comments" className="block text-sm font-medium mb-1">
                Comentarios
              </label>
              <Textarea
                id="comments"
                placeholder="Ej: Sin verduras, extra salsa, etc."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddToCart}>
                <ShoppingCart className="mr-2 h-4 w-4" />
                Agregar al Carrito
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
