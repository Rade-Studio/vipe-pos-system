"use client"

import type { Category } from "@/types"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"

interface CategoryListProps {
  categories: Category[]
  selected: string | null
  onSelect: (id: string) => void
}

export default function CategoryList({ categories, selected, onSelect }: CategoryListProps) {
  const selectedCategory = categories.find((c) => c.id === selected)

  return (
    <Sheet>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-lg">{selectedCategory?.name}</p>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            Categorías
          </Button>
        </SheetTrigger>
      </div>
      <SheetContent side="bottom" className="p-4">
        <SheetHeader>
          <SheetTitle>Elige una categoría</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-2">
          {categories.map((c) => (
            <SheetClose asChild key={c.id}>
              <Button
                variant={selected === c.id ? "default" : "outline"}
                onClick={() => onSelect(c.id)}
                className="w-full justify-start"
              >
                {c.name}
              </Button>
            </SheetClose>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
