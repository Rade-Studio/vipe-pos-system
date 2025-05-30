"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertCircle, Package } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StockTransactionForm } from "./StockTransactionForm"
// Importar el componente Skeleton
import { Skeleton } from "@/components/ui/skeleton"
import {repositories} from "@/lib";

export function LowStockIngredients() {
  const { toast } = useToast()
  const [ingredients, setIngredients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openStockDialog, setOpenStockDialog] = useState(false)
  const [selectedIngredient, setSelectedIngredient] = useState<any>(null)
  // Agregar un nuevo estado para controlar si se muestran todos los elementos
  const [showAll, setShowAll] = useState(false)

  const fetchIngredients = async () => {
    setLoading(true)
    try {
      const data = await repositories.ingredients.getAll()
      // Filtrar solo los ingredientes con stock bajo
      const lowStockItems = data.filter((item) => item.stock <= item.min_stock)
      setIngredients(lowStockItems)
    } catch (error: any) {
      console.error("Error fetching ingredients:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar los ingredientes: ${error.message}`,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIngredients()
  }, [])

  const handleStockTransaction = (ingredient: any) => {
    setSelectedIngredient(ingredient)
    setOpenStockDialog(true)
  }

  const handleStockDialogClose = () => {
    setOpenStockDialog(false)
    setSelectedIngredient(null)
    fetchIngredients() // Actualizar la lista después de cerrar
  }

  // Reemplazar el indicador de carga simple por Skeletons
  // Buscar:
  // Reemplazar con:
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="border-muted-foreground/20">
              <CardContent className="p-4">
                <div className="flex justify-between items-start">
                  <div className="w-full">
                    <Skeleton className="h-5 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-1/2 mb-4" />
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                    <Skeleton className="h-8 w-full" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (ingredients.length === 0) {
    return <div className="text-center py-4 text-muted-foreground">No hay ingredientes con stock bajo</div>
  }

  // Limitar los ingredientes a mostrar si showAll es false
  const displayedIngredients = showAll ? ingredients : ingredients.slice(0, 9)
  const hasMore = ingredients.length > 9

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedIngredients.map((ingredient) => (
          <Card key={ingredient.id} className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium flex items-center dark:text-red-100">
                    <AlertCircle className="h-4 w-4 mr-1 text-red-500 dark:text-red-300" />
                    {ingredient.name}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1 dark:text-red-200/70">
                    Categoría: {ingredient.category}
                  </div>
                </div>
                <Badge variant="destructive" className="ml-2 dark:bg-red-700 dark:hover:bg-red-600 dark:text-white">
                  Stock bajo
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground dark:text-red-200/70">Stock actual:</span>
                  <span className="font-medium ml-1 text-red-600 dark:text-red-300">{ingredient.stock}</span>
                </div>
                <div>
                  <span className="text-muted-foreground dark:text-red-200/70">Stock mínimo:</span>
                  <span className="font-medium ml-1 dark:text-red-100">{ingredient.min_stock}</span>
                </div>
                <div>
                  <span className="text-muted-foreground dark:text-red-200/70">Unidad:</span>
                  <span className="font-medium ml-1 dark:text-red-100">{ingredient.unit}</span>
                </div>
                <div>
                  <span className="text-muted-foreground dark:text-red-200/70">Costo:</span>
                  <span className="font-medium ml-1 dark:text-red-100">${ingredient.cost?.toFixed(2) || "0.00"}</span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full mt-4 dark:border-red-700 dark:text-red-100 dark:hover:bg-red-900 dark:hover:text-red-50"
                onClick={() => handleStockTransaction(ingredient)}
              >
                <Package className="h-4 w-4 mr-2" />
                Añadir stock
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" onClick={() => setShowAll(!showAll)} className="text-sm">
            {showAll ? "Mostrar menos" : `Ver todos (${ingredients.length})`}
          </Button>
        </div>
      )}

      <Dialog open={openStockDialog} onOpenChange={setOpenStockDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Registrar Transacción de Stock</DialogTitle>
          </DialogHeader>
          <StockTransactionForm ingredientId={selectedIngredient?.id} onSuccess={handleStockDialogClose} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
