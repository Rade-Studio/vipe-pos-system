"use client"

import { useState, useEffect } from "react"
import type { Category, Dish } from "@/types"
import { categoryService } from "@/lib/supabase/service"
import { dishServiceWithPromotions } from "@/lib/supabase/dish-service-with-promotions"
import CategoryList from "./CategoryList"
import DishGrid from "./DishGrid"

interface PublicMenuProps {
  onAdd?: (dish: Dish) => void
  enableAdd?: boolean
}

export default function PublicMenu({ onAdd, enableAdd }: PublicMenuProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function loadCategories() {
      const data = await categoryService.getAllActive()
      setCategories(data)
      if (data.length > 0) {
        setSelectedCategory(data[0].id)
      }
    }
    loadCategories()
  }, [])

  useEffect(() => {
    if (!selectedCategory) return
    setLoading(true)
    dishServiceWithPromotions
      .getByCategoryWithPromotions(selectedCategory)
      .then((data) => setDishes(data))
      .finally(() => setLoading(false))
  }, [selectedCategory])

  if (categories.length === 0) {
    return <p className="text-center py-10">No hay categorías disponibles</p>
  }

  return (
    <div className="space-y-4">
      <CategoryList categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      {loading ? <p className="text-center py-10">Cargando...</p> : (
        <DishGrid dishes={dishes} onAdd={onAdd} showAddButton={enableAdd} />
      )}
    </div>
  )
}
