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

// Traducciones al español para mostrar en la interfaz
const iconTranslations: Record<string, string> = {
  Coffee: "Café",
  UtensilsCrossed: "Utensilios cruzados",
  Utensils: "Utensilios",
  ChefHat: "Gorro de chef",
  Apple: "Manzana",
  Beer: "Cerveza",
  Beef: "Carne",
  Cake: "Pastel",
  Cherry: "Cereza",
  Cookie: "Galleta",
  Croissant: "Croissant",
  Egg: "Huevo",
  Fish: "Pescado",
  Flame: "Llama",
  IceCream: "Helado",
  Lemon: "Limón",
  Milk: "Leche",
  Pizza: "Pizza",
  Salad: "Ensalada",
  Sandwich: "Sándwich",
  Soup: "Sopa",
  Wine: "Vino",
  Banana: "Banana",
  Carrot: "Zanahoria",
  Cheese: "Queso",
  Drumstick: "Muslo",
  Hamburger: "Hamburguesa",
  Popcorn: "Palomitas",
  Taco: "Taco",
  Vegetable: "Vegetal",
  Wheat: "Trigo",
  Cocktail: "Cóctel",
  Dessert: "Postre",
  Drink: "Bebida",
  Fruit: "Fruta",
  GlassWater: "Vaso de agua",
  Grape: "Uva",
  IceCream2: "Helado 2",
  Martini: "Martini",
  Meat: "Carne",
  Orange: "Naranja",
  Pasta: "Pasta",
  Pepper: "Pimienta",
  Pie: "Pastel de fruta",
  Rice: "Arroz",
  Sushi: "Sushi",
  Tea: "Té",
  Tomato: "Tomate",
  Watermelon: "Sandía",
  Bread: "Pan",
  Broccoli: "Brócoli",
  Candy: "Dulce",
  Chili: "Chile",
  Chocolate: "Chocolate",
  Coconut: "Coco",
  CupSoda: "Vaso de refresco",
  Donut: "Donut",
  Fridge: "Refrigerador",
  Grill: "Parrilla",
  HotDog: "Hot Dog",
  IceCreams: "Helados",
  Kebab: "Kebab",
  Lollipop: "Paleta",
  Microwave: "Microondas",
  Mug: "Taza",
  Mushroom: "Hongo",
  Noodles: "Fideos",
  Oven: "Horno",
  Pear: "Pera",
  Pineapple: "Piña",
  Potato: "Patata",
  Pretzel: "Pretzel",
  Refrigerator: "Refrigerador",
  Sausage: "Salchicha",
  Shrimp: "Camarón",
  Steak: "Filete",
  Strawberry: "Fresa",
  Toaster: "Tostadora",
  Waffle: "Waffle",
  Yogurt: "Yogur",
}

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
  const filteredIcons = validIcons.filter((icon) => {
    const spanish = iconTranslations[icon] ?? icon
    return spanish.toLowerCase().includes(searchTerm.toLowerCase())
  })

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
              {iconTranslations[safeSelectedIcon] ?? safeSelectedIcon}
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
                      {iconTranslations[icon] ?? icon}
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
