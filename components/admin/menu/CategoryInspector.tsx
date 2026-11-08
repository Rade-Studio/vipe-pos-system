"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import { deleteCategory, type CategoryDto } from "@/lib/api/catalog"
import { ApiError } from "@/lib/api/errors"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { catalogKeys, errorMessage, invalidateCatalogReaders, type AdminCategoryNode } from "@/lib/admin/catalog"
import { CategoryForm } from "./CategoryForm"
import { DishDialog } from "./DishDialog"
import { SubcategoryManager } from "./SubcategoryManager"
import { SubcategoryStep } from "./SubcategoryStep"
import { plural } from "./WaiterPreview"

interface CategoryInspectorProps {
  node: AdminCategoryNode
  position: number
  total: number
  categories: CategoryDto[]
  subcategories: SubcategoryDto[]
  onMove: (delta: -1 | 1) => void
  onDeleted: () => void
  /** "Ver N platos →": Menú → Platos filtered to this category (dishes are listed only there). */
  onShowDishes: () => void
  moving: boolean
}

/** The selected category: name, colour, icon, its subcategory step, subcategories and dishes. */
export function CategoryInspector({
  node,
  position,
  total,
  categories,
  subcategories,
  onMove,
  onDeleted,
  onShowDishes,
  moving,
}: CategoryInspectorProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [creatingDish, setCreatingDish] = useState(false)
  const { category } = node
  const dishCount = node.dishCount

  const handleDelete = async () => {
    setConfirmDelete(false)
    try {
      await deleteCategory(category.id)
      toast({ title: "Categoría eliminada", description: `La categoría ${category.name} ha sido eliminada correctamente.` })
      onDeleted()
      void invalidateCatalogReaders(queryClient, catalogKeys.categories)
    } catch (error) {
      log.error("Error deleting category:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        // 409: dishes ("Category has dishes", the old English message) or subcategories (Spanish, shown as is).
        description:
          error instanceof ApiError && error.status === 409 && error.message === "Category has dishes"
            ? "No se puede eliminar la categoría porque tiene platos; muévelos o elimínalos primero."
            : errorMessage(error),
      })
    }
  }

  return (
    <section aria-label={`Editar categoría ${category.name}`} className="min-w-0 space-y-5">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`inspector-${category.id}`} tabIndex={-1} className="break-words text-lg font-semibold [overflow-wrap:anywhere] focus:outline-none">
            {category.name}
          </h2>
          <p className="text-sm text-muted-fg">
            Posición {position} de {total} en el paso 1 del mesero
            {!category.active && " · Inactiva: el mesero no la ve"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1" role="group" aria-label="Mover la categoría">
          <Button type="button" variant="outline" className="min-h-11" disabled={moving || position === 1} onClick={() => onMove(-1)}>
            <ArrowUp className="mr-1 h-4 w-4" aria-hidden />
            Subir
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={moving || position === total} onClick={() => onMove(1)}>
            <ArrowDown className="mr-1 h-4 w-4" aria-hidden />
            Bajar
          </Button>
        </div>
      </header>

      <CategoryForm
        key={category.id}
        category={category}
        compact
        onSuccess={() => void invalidateCatalogReaders(queryClient, catalogKeys.categories)}
      />

      <SubcategoryStep node={node} />
      <SubcategoryManager node={node} inputId={`new-subcategory-${category.id}`} />

      <section aria-labelledby={`dishes-${category.id}`} className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`dishes-${category.id}`} className="text-sm font-semibold">
            Platos de {category.name}
          </h3>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setCreatingDish(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Nuevo plato
          </Button>
        </div>
        {dishCount === 0 ? (
          <p className="text-sm text-muted-fg">Sin platos todavía.</p>
        ) : (
          <Button type="button" variant="link" className="min-h-11 px-0 text-sm font-semibold" onClick={onShowDishes}>
            Ver {plural(dishCount, "plato", "platos")} →
          </Button>
        )}
      </section>

      <div className="border-t border-line pt-4">
        <Button type="button" variant="outline" className="min-h-11 text-status-danger-fg" onClick={() => setConfirmDelete(true)}>
          <Trash className="mr-1 h-4 w-4" aria-hidden />
          Eliminar categoría
        </Button>
      </div>

      <DishDialog
        open={creatingDish}
        onOpenChange={setCreatingDish}
        dish={null}
        categories={categories}
        subcategories={subcategories}
        defaultCategoryId={category.id}
        onSaved={() => {
          void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
          void queryClient.invalidateQueries({ queryKey: catalogKeys.categories })
          setCreatingDish(false)
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la categoría {category.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Solo se puede eliminar sin platos ni subcategorías.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
