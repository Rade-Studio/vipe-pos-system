"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown } from "lucide-react"
import * as LucideIcons from "lucide-react"

// Lista de iconos de cocina/restaurante disponibles en Lucide
const kitchenIcons = [
  "Coffee",
  "UtensilsCrossed",
  "Utensils",
  "ChefHat",
  "Apple",
  "Beer",
  "Beef",
  "Cake",
  "Cherry",
  "Cookie",
  "Croissant",
  "Egg",
  "Fish",
  "Flame",
  "IceCream",
  "Lemon",
  "Milk",
  "Pizza",
  "Salad",
  "Sandwich",
  "Soup",
  "Wine",
  "Banana",
  "Carrot",
  "Cheese",
  "Drumstick",
  "Hamburger",
  "Popcorn",
  "Sandwich",
  "Taco",
  "Vegetable",
  "Wheat",
  "Cocktail",
  "Coffee",
  "Dessert",
  "Drink",
  "Fruit",
  "GlassWater",
  "Grape",
  "IceCream2",
  "Martini",
  "Meat",
  "Orange",
  "Pasta",
  "Pepper",
  "Pie",
  "Rice",
  "Salad",
  "Sushi",
  "Tea",
  "Tomato",
  "Watermelon",
  "Bread",
  "Broccoli",
  "Candy",
  "Chili",
  "Chocolate",
  "Coconut",
  "CupSoda",
  "Donut",
  "Fridge",
  "Grill",
  "HotDog",
  "IceCreams",
  "Kebab",
  "Lollipop",
  "Microwave",
  "Mug",
  "Mushroom",
  "Noodles",
  "Oven",
  "Pear",
  "Pineapple",
  "Potato",
  "Pretzel",
  "Refrigerator",
  "Sausage",
  "Shrimp",
  "Steak",
  "Strawberry",
  "Toaster",
  "Waffle",
  "Yogurt",
]

// Filtrar solo los iconos que existen en Lucide
const validIcons = kitchenIcons.filter((icon) => Boolean((LucideIcons as any)[icon]))

interface IconSelectorProps {
  selectedIcon?: string
  onSelectIcon: (icon: string) => void
}

export function IconSelector({ selectedIcon, onSelectIcon }: IconSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  // Asegurarse de que el icono seleccionado sea válido
  const safeSelectedIcon = selectedIcon && (LucideIcons as any)[selectedIcon] ? selectedIcon : undefined

  // Filtrar iconos basados en el término de búsqueda
  const filteredIcons = validIcons.filter((icon) => icon.toLowerCase().includes(searchTerm.toLowerCase()))

  // Renderizar el icono seleccionado
  const renderSelectedIcon = () => {
    if (!safeSelectedIcon) return null
    const IconComponent = (LucideIcons as any)[safeSelectedIcon]
    return <IconComponent className="h-4 w-4 mr-2" />
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          {safeSelectedIcon ? (
            <div className="flex items-center">
              {renderSelectedIcon()}
              {safeSelectedIcon}
            </div>
          ) : (
            "Seleccionar icono"
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Buscar icono..." value={searchTerm} onValueChange={setSearchTerm} />
          <CommandList>
            <CommandEmpty>No se encontraron iconos.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              {filteredIcons.map((icon) => {
                const IconComponent = (LucideIcons as any)[icon]
                return (
                  <CommandItem
                    key={icon}
                    value={icon}
                    onSelect={() => {
                      onSelectIcon(icon)
                      setOpen(false)
                    }}
                  >
                    <div className="flex items-center">
                      <IconComponent className="h-4 w-4 mr-2" />
                      {icon}
                    </div>
                    {safeSelectedIcon === icon && <Check className="ml-auto h-4 w-4" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
