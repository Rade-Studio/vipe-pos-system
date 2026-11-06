"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Edit, Plus, Trash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { deleteCategory, type CategoryDto, type DishDto } from "@/lib/api/catalog"
import { ApiError } from "@/lib/api/errors"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { catalogKeys, errorMessage, invalidateCatalogReaders, type AdminCategoryNode } from "@/lib/admin/catalog"
import { formatCurrency } from "@/utils/helpers"
import { CategoryForm } from "./CategoryForm"
import { DishForm } from "./DishForm"
import { SubcategoryManager } from "./SubcategoryManager"
import { SubcategoryStep } from "./SubcategoryStep"

interface CategoryInspectorProps {
  node: AdminCategoryNode
  position: number
  total: number
  categories: CategoryDto[]
  subcategories: SubcategoryDto[]
  onMove: (delta: -1 | 1) => void
  onDeleted: () => void
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
  moving,
}: CategoryInspectorProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dishDialog, setDishDialog] = useState<{ dish: DishDto | null } | null>(null)
  const { category } = node
  const dishes = [...node.subcategories.flatMap((s) => s.dishes), ...node.looseDishes].sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  )
  const subcategoryName = (id: string | null) => node.subcategories.find((s) => s.subcategory.id === id)?.subcategory.name

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
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setDishDialog({ dish: null })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Nuevo plato
          </Button>
        </div>
        {dishes.length === 0 ? (
          <p className="text-sm text-muted-fg">Sin platos todavía.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-card">
            {dishes.map((dish) => (
              <li key={dish.id} className="flex min-w-0 items-center gap-2 py-1 pl-3 pr-1">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm [overflow-wrap:anywhere]">{dish.name}</span>
                  <span className="block text-xs text-muted-fg">
                    {subcategoryName(dish.subcategoryId) ?? "Sin subcategoría"} · {formatCurrency(dish.price)}
                    {!dish.active && " · Inactivo"}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-focus focus-visible:ring-0"
                  aria-label={`Editar ${dish.name}`}
                  onClick={() => setDishDialog({ dish })}
                >
                  <Edit className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-t border-line pt-4">
        <Button type="button" variant="outline" className="min-h-11 text-status-danger-fg" onClick={() => setConfirmDelete(true)}>
          <Trash className="mr-1 h-4 w-4" aria-hidden />
          Eliminar categoría
        </Button>
      </div>

      <Dialog open={dishDialog !== null} onOpenChange={(open) => !open && setDishDialog(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{dishDialog?.dish ? "Editar Plato" : "Nuevo Plato"}</DialogTitle>
          </DialogHeader>
          {dishDialog && (
            <DishForm
              dish={dishDialog.dish}
              isNewDish={!dishDialog.dish}
              categories={categories}
              subcategories={subcategories}
              defaultCategoryId={category.id}
              onSuccess={() => {
                void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
                void queryClient.invalidateQueries({ queryKey: catalogKeys.categories })
                setDishDialog(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

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
