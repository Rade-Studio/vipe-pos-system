"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { updateDish } from "@/lib/api/catalog"
import * as subcategoriesApi from "@/lib/api/subcategories"
import {
  catalogKeys,
  errorMessage,
  invalidateCatalogReaders,
  planGeneralSubcategory,
  planMergeIntoCategory,
  type AdminCategoryNode,
} from "@/lib/admin/catalog"
import { plural } from "./WaiterPreview"

const PREVIEW_DISHES = 6

/**
 * "Sin subcategorías" is derived (no dish of the category sits in a
 * subcategory), so switching it is a data change on the dishes, offered as two
 * explicit, confirmed actions instead of a toggle.
 */
export function SubcategoryStep({ node }: { node: AdminCategoryNode }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState<"merge" | "general" | null>(null)
  const [busy, setBusy] = useState(false)
  const { category } = node
  const mergeIds = planMergeIntoCategory(node)
  const general = planGeneralSubcategory(node)
  const mergedNames = node.subcategories.flatMap((s) => s.dishes.map((dish) => dish.name))

  /** Moves the dishes one by one; on a refusal it stops and says how far it got. */
  const moveDishes = async (ids: string[], subcategoryId: string | null) => {
    let moved = 0
    for (const id of ids) {
      await updateDish(id, { subcategoryId })
      moved++
    }
    return moved
  }

  const apply = async (kind: "merge" | "general") => {
    setConfirm(null)
    setBusy(true)
    const ids = kind === "merge" ? mergeIds : general.dishIds
    let moved = 0
    try {
      if (kind === "merge") {
        moved = await moveDishes(ids, null)
        toast({ title: "Platos unidos", description: `${category.name} ya no tiene paso de subcategorías.` })
      } else {
        let target = general.existingId
        if (target) {
          const existing = node.subcategories.find((s) => s.subcategory.id === target)
          if (existing && !existing.subcategory.active) await subcategoriesApi.update(target, { active: true })
        } else {
          target = (await subcategoriesApi.create({ categoryId: category.id, name: general.name })).id
        }
        moved = await moveDishes(ids, target)
        toast({ title: "Subcategoría General lista", description: `Los platos de ${category.name} están en «General».` })
      }
    } catch (error) {
      log.error("Error changing the subcategory step:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Se movieron ${moved} de ${ids.length} platos: ${errorMessage(error)}`,
      })
    } finally {
      setBusy(false)
      void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
      void queryClient.invalidateQueries({ queryKey: catalogKeys.subcategories })
      void queryClient.invalidateQueries({ queryKey: catalogKeys.categories })
    }
  }

  return (
    <section aria-labelledby={`step-${category.id}`} className="min-w-0 rounded-card border border-line bg-card p-3.5">
      <h3 id={`step-${category.id}`} className="sr-only">
        Paso de subcategorías
      </h3>
      {node.skipsSubcategoryStep ? (
        <>
          <b className="block text-[15px]">Sin subcategorías</b>
          <p className="mt-0.5 text-sm text-muted-fg">
            El mesero salta el paso 2 y ve los platos de {category.name} directo.
            {node.dishCount === 0 && " Aún no tiene platos."}
          </p>
          {general.dishIds.length > 0 && (
            <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={() => setConfirm("general")}>
              Crear subcategoría General
            </Button>
          )}
        </>
      ) : (
        <>
          <b className="block text-[15px]">Con subcategorías</b>
          <p className="mt-0.5 text-sm text-muted-fg">
            El mesero elige una subcategoría en el paso 2.
            {node.looseDishes.length > 0 &&
              ` ${plural(node.looseDishes.length, "plato aún no tiene", "platos aún no tienen")} subcategoría.`}
          </p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={() => setConfirm("merge")}>
            Unir platos en la categoría
          </Button>
        </>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          {confirm === "merge" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Quitar el paso de subcategorías en {category.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Sus {plural(mergeIds.length, "plato quedará", "platos quedarán")} en una sola lista y el mesero los verá
                  directo. Las subcategorías quedan vacías; puedes eliminarlas después.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ol className="list-decimal space-y-0.5 pl-6 text-sm">
                {mergedNames.slice(0, PREVIEW_DISHES).map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
                {mergedNames.length > PREVIEW_DISHES && <li>y {mergedNames.length - PREVIEW_DISHES} más…</li>}
              </ol>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={() => void apply("merge")}>
                  Unir platos
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Agregar el paso de subcategorías en {category.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {general.existingId ? "Se usa la subcategoría «General» que ya existe." : "Se crea la subcategoría «General»."}{" "}
                  Sus {general.dishIds.length} platos pasarán a «General» y el mesero verá el paso 2. Luego puedes crear más
                  subcategorías y mover platos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" onClick={() => void apply("general")}>
                  Crear y mover platos
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
