"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import type { Category } from "@/types"
import {
  Utensils,
  Pizza,
  IceCream,
  GlassWater,
  Coffee,
  Beef,
  Sandwich,
  Salad,
  Soup,
  Dessert,
  Wine,
  Beer,
  CoffeeIcon as Cocktail,
  Martini,
  Cake,
  Croissant,
  Egg,
  Fish,
  Drumstick,
  Banana,
  Apple,
  Carrot,
  ChevronsUpIcon as Cheese,
  CroissantIcon as Bread,
} from "lucide-react"

// Mapa de iconos disponibles
const iconMap: Record<string, React.ReactNode> = {
  utensils: <Utensils className="h-4 w-4" />,
  pizza: <Pizza className="h-4 w-4" />,
  icecream: <IceCream className="h-4 w-4" />,
  water: <GlassWater className="h-4 w-4" />,
  coffee: <Coffee className="h-4 w-4" />,
  beef: <Beef className="h-4 w-4" />,
  sandwich: <Sandwich className="h-4 w-4" />,
  salad: <Salad className="h-4 w-4" />,
  soup: <Soup className="h-4 w-4" />,
  dessert: <Dessert className="h-4 w-4" />,
  wine: <Wine className="h-4 w-4" />,
  beer: <Beer className="h-4 w-4" />,
  cocktail: <Cocktail className="h-4 w-4" />,
  martini: <Martini className="h-4 w-4" />,
  cake: <Cake className="h-4 w-4" />,
  croissant: <Croissant className="h-4 w-4" />,
  egg: <Egg className="h-4 w-4" />,
  fish: <Fish className="h-4 w-4" />,
  chicken: <Drumstick className="h-4 w-4" />,
  banana: <Banana className="h-4 w-4" />,
  apple: <Apple className="h-4 w-4" />,
  carrot: <Carrot className="h-4 w-4" />,
  cheese: <Cheese className="h-4 w-4" />,
  bread: <Bread className="h-4 w-4" />,
}

interface CategorySelectorProps {
  categories: Category[]
  selectedCategory: string | null
  onSelectCategory: (categoryId: string) => void
}

export function CategorySelector({ categories, selectedCategory, onSelectCategory }: CategorySelectorProps) {
  // Función para obtener el icono según el nombre
  const getIcon = (iconName: string | null) => {
    if (!iconName) return <Utensils className="h-4 w-4" />
    return iconMap[iconName.toLowerCase()] || <Utensils className="h-4 w-4" />
  }

  return (
    <div className="flex gap-2 mb-4">
      {categories.map((category) => (
        <Button
          key={category.id}
          variant={selectedCategory === category.id ? "default" : "outline"}
          className="flex items-center gap-2 whitespace-nowrap"
          onClick={() => onSelectCategory(category.id)}
        >
          {typeof category.icon === "string" ? getIcon(category.icon) : category.icon}
          {category.name}
        </Button>
      ))}
    </div>
  )
}
