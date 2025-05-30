"use client"

import { useState, useEffect } from "react"
import { CategorySelector } from "@/components/pos/CategorySelector"
import { DishGrid } from "@/components/pos/DishGrid"
import type { Category, Dish } from "@/types"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import {repositories} from "@/lib";

interface MenuSectionProps {
  onAddToCart: (dish: Dish, comments?: string) => void
}

export function MenuSection({ onAddToCart }: MenuSectionProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loadingDishes, setLoadingDishes] = useState(false)
  const { toast } = useToast()

  // Cargar categorías al montar el componente
  useEffect(() => {
    loadCategories()
  }, [])

  // Cargar platos cuando cambia la categoría seleccionada
  useEffect(() => {
    if (selectedCategory) {
      loadDishesByCategory(selectedCategory)
    }
  }, [selectedCategory])

  // Función para cargar categorías desde la base de datos
  const loadCategories = async () => {
    setLoadingCategories(true)
    try {
      const data = await repositories.categories.getAll()

      // Convertir los datos de la base de datos al formato que espera el componente
      const formattedCategories = data.map((category) => {
        return {
          id: category.id,
          name: category.name,
          icon: category.icon || null, // Asumiendo que el icono se guarda como string
        }
      })

      setCategories(formattedCategories)

      // Seleccionar la primera categoría por defecto
      if (formattedCategories.length > 0 && !selectedCategory) {
        setSelectedCategory(formattedCategories[0].id)
      }
    } catch (err) {
      console.error("Error al cargar categorías:", err)
      toast({
        title: "Error",
        description: "No se pudieron cargar las categorías. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setLoadingCategories(false)
    }
  }

  // Función para cargar platos por categoría desde la base de datos
  const loadDishesByCategory = async (categoryId: string) => {
    setLoadingDishes(true)
    try {
      // Usar el nuevo servicio con promociones
      const data = await repositories.dishes.getByCategoryWithPromotions(categoryId)

      // Convertir los datos de la base de datos al formato que espera el componente
      const formattedDishes = data.map((dish) => ({
        id: dish.id,
        name: dish.name,
        price: dish.price,
        categoryId: dish.categoryId,
        image: dish.image || "/placeholder.svg?height=80&width=80",
        // Añadir campos de promoción si existen
        originalPrice: dish.originalPrice,
        discountAmount: dish.discountAmount,
        discountPercentage: dish.discountPercentage,
        promotionId: dish.promotionId,
        promotionName: dish.promotionName,
      }))

      setDishes(formattedDishes)
    } catch (err) {
      console.error("Error al cargar platos:", err)
      toast({
        title: "Error",
        description: "No se pudieron cargar los platos. Intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setLoadingDishes(false)
    }
  }

  // Si estamos cargando categorías, mostrar un indicador de carga
  if (loadingCategories) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Menú</h2>
        <div className="flex space-x-2 overflow-x-auto py-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="border rounded-lg p-4 flex flex-col items-center">
              <Skeleton className="h-20 w-20 rounded-full mb-2" />
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Si no hay categorías, mostrar un mensaje
  if (categories.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg bg-muted/20">
        <p className="text-lg font-medium">No hay categorías disponibles</p>
        <p className="text-sm text-muted-foreground mt-1">
          Por favor, agregue categorías desde el panel de administración.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Menú</h2>

      {/* Categories - Scrollable on mobile */}
      <div className="overflow-x-auto -mx-1 px-1 md:mx-0 md:px-0">
        <div className="min-w-[600px] md:min-w-0">
          <CategorySelector
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </div>
      </div>

      {/* Dishes */}
      <div className="min-h-[300px]">
        {loadingDishes ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="border rounded-lg p-4 flex flex-col items-center">
                <Skeleton className="h-20 w-20 rounded-full mb-2" />
                <Skeleton className="h-4 w-24 mb-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <DishGrid dishes={dishes} onAddToCart={onAddToCart} />
        )}
      </div>
    </div>
  )
}
