"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { CategoryDto, DishDto } from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import { cn } from "@/lib/utils"
import { DishForm } from "./DishForm"

interface DishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The dish to edit; null creates one. */
  dish: DishDto | null
  categories: CategoryDto[]
  subcategories: SubcategoryDto[]
  defaultCategoryId?: string
  defaultSubcategoryId?: string
  soldOut?: boolean
  onOpenFormula?: () => void
  onSaved: () => void
}

/**
 * The dish create/edit dialog (menu-platos T2, design 01): a modal that scrolls
 * inside itself with Guardar/Cancelar stuck to its bottom; below 640 px it fills
 * the screen like a sheet.
 */
export function DishDialog({
  open,
  onOpenChange,
  dish,
  categories,
  subcategories,
  defaultCategoryId,
  defaultSubcategoryId,
  soldOut,
  onOpenFormula,
  onSaved,
}: DishDialogProps) {
  const categoryId = dish ? dish.categoryId : (defaultCategoryId ?? null)
  const subcategoryId = dish ? dish.subcategoryId : (defaultSubcategoryId ?? null)
  const categoryName = categories.find((c) => c.id === categoryId)?.name
  const subcategoryName = subcategories.find((s) => s.id === subcategoryId)?.name
  const where = categoryName ? [categoryName, subcategoryName].filter(Boolean).join(" › ") : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "block max-h-[90dvh] overflow-y-auto overscroll-contain p-0 sm:max-w-[640px]",
          // Phone: a full-screen sheet.
          "max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
          // The stock close "X" grows to a 44 px target.
          "[&>button.absolute]:right-2 [&>button.absolute]:top-2 [&>button.absolute]:grid [&>button.absolute]:h-11 [&>button.absolute]:w-11 [&>button.absolute]:place-items-center",
        )}
      >
        <DialogHeader className="px-4 pb-3 pr-14 pt-5 text-left sm:px-6">
          <DialogTitle>{dish ? "Editar plato" : "Nuevo plato"}</DialogTitle>
          {where ? (
            <DialogDescription className="break-words [overflow-wrap:anywhere]">
              {dish ? `${dish.name} · ${where}` : `En ${where}`}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Datos del plato</DialogDescription>
          )}
        </DialogHeader>
        {open && (
          <DishForm
            dish={dish}
            isNewDish={!dish}
            categories={categories}
            subcategories={subcategories}
            defaultCategoryId={defaultCategoryId}
            defaultSubcategoryId={defaultSubcategoryId}
            soldOut={soldOut}
            onOpenFormula={onOpenFormula}
            onCancel={() => onOpenChange(false)}
            onSuccess={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
