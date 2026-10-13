"use client"

import { useEffect, useState } from "react"
import { log } from "@/lib/log"
import { CategorySelector } from "@/components/pos/CategorySelector"
import { DishGrid } from "@/components/pos/DishGrid"
import { useMenuCategories, useMenuDishes } from "@/hooks/use-menu"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import type { Dish } from "@/types"

interface MenuSectionProps {
  onAddToCart: (dish: Dish, comments?: string) => void
}

/**
 * Categories, dishes and their promotions come from React Query (T6/S1/S2).
 *
 * This component is mounted per active table, and the Radix tab unmounts it
 * when the waiter looks at the orders. It used to re-read everything on each
 * mount behind full skeletons; now a remount reads the cache, and a category
 * switch keeps the previous dishes on screen (see `useMenuDishes`). Skeletons
 * are for the very first load only — `isPending` is false as soon as any data
 * (previous or cached) is in place.
 */
export function MenuSection({ onAddToCart }: MenuSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const { toast } = useToast()

  const {
    data: categories = [],
    isPending: categoriesPending,
    isError: categoriesError,
  } = useMenuCategories()

  const {
    data: dishes = [],
    isPending: dishesPending,
    isError: dishesError,
  } = useMenuDishes(selectedCategory)

  // Seleccionar la primera categoría por defecto (una sola vez, cuando llegan)
  useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].id)
    }
  }, [categories, selectedCategory])

  useEffect(() => {
    if (categoriesError) {
      log.error("Error al cargar categorías:", { err: String(categoriesError) })
      toast({
        title: "Error",
        description: "No se pudieron cargar las categorías. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }, [categoriesError, toast])

  useEffect(() => {
    if (dishesError) {
      log.error("Error al cargar platos:", { err: String(dishesError) })
      toast({
        title: "Error",
        description: "No se pudieron cargar los platos. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }, [dishesError, toast])

  // Si estamos cargando categorías por primera vez, mostrar un indicador de carga
  if (categoriesPending && categories.length === 0) {
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
        {dishesPending && dishes.length === 0 ? (
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