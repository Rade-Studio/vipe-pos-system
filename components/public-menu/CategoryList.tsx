"use client"

import type { Category } from "@/types"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface CategoryListProps {
  categories: Category[]
  selected: string | null
  onSelect: (id: string) => void
}

export default function CategoryList({ categories, selected, onSelect }: CategoryListProps) {
  return (
    <Tabs value={selected ?? undefined} onValueChange={onSelect} className="w-full">
      <TabsList className="w-full overflow-x-auto">
        {categories.map((c) => (
          <TabsTrigger key={c.id} value={c.id} className="whitespace-nowrap">
            {c.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
