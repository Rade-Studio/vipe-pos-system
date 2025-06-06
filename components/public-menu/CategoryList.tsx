"use client"

import type { Category } from "@/types"
import { Button } from "@/components/ui/button"

interface CategoryListProps {
  categories: Category[]
  selected: string | null
  onSelect: (id: string) => void
}

export default function CategoryList({ categories, selected, onSelect }: CategoryListProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {categories.map((c) => (
        <Button
          key={c.id}
          variant={selected === c.id ? "default" : "outline"}
          onClick={() => onSelect(c.id)}
          className="whitespace-nowrap"
        >
          {c.name}
        </Button>
      ))}
    </div>
  )
}
