"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import { deleteDish, type CategoryDto, type DishDto, type MenuTreeDto } from "@/lib/api/catalog"
import {
  ADMIN_LIST_STALE_MS,
  buildAdminMenuTree,
  catalogKeys,
  errorMessage,
  fetchCategories,
  fetchDishes,
  fetchMenuDraft,
  fetchSubcategories,
  invalidateCatalogReaders,
} from "@/lib/admin/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
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
import { Pagination } from "@/components/ui/pagination"
import { ItemsPerPage } from "@/components/ui/items-per-page"
import { usePagination } from "@/hooks/use-pagination"
import { cn } from "@/lib/utils"
import { DishDialog } from "./DishDialog"
import { DishRow } from "./DishRow"
import { nativeSelect } from "./ModifierOptionRow"
import { plural } from "./WaiterPreview"

/** The Platos tab filter: a category, optionally one of its subcategories; nulls show every dish. */
export interface DishFilter {
  categoryId: string | null
  subcategoryId: string | null
}
export const ALL_DISHES: DishFilter = { categoryId: null, subcategoryId: null }

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
/** The stock pagination and page-size controls are 40 px; inside the list they grow to 44. */
const tallControls = "[&_button]:min-h-11 [&_button]:min-w-11"

const filterValue = ({ categoryId, subcategoryId }: DishFilter) =>
  categoryId ? (subcategoryId ? `${categoryId}|${subcategoryId}` : categoryId) : ""
const parseFilter = (value: string): DishFilter => {
  const [categoryId, subcategoryId] = value.split("|")
  return { categoryId: categoryId || null, subcategoryId: subcategoryId || null }
}

interface DishListProps {
  onNavigate?: (sectionId: string) => void
  /** Controlled filter (Menú → Categorías "Ver N platos →" sets it); uncontrolled without it. */
  filter?: DishFilter
  onFilterChange?: (filter: DishFilter) => void
}

/**
 * Menú → Platos (menu-platos T2, design 01): every dish in dense rows with
 * search, one category/subcategory filter and pages; Fórmula, edit and delete
 * per row. "Agotado" comes from the draft menu, the only read that carries it.
 */
export function DishList({ onNavigate, filter, onFilterChange }: DishListProps = {}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [ownFilter, setOwnFilter] = useState<DishFilter>(filter ?? ALL_DISHES)
  const [dialog, setDialog] = useState<{ dish: DishDto | null } | null>(null)
  const [toDelete, setToDelete] = useState<DishDto | null>(null)
  const current = filter ?? ownFilter
  const changeFilter = (next: DishFilter) => {
    setOwnFilter(next)
    onFilterChange?.(next)
  }

  const { data: dishes = [], isLoading, isError, error } = useQuery<DishDto[]>({
    queryKey: catalogKeys.dishes,
    queryFn: fetchDishes,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: categories = [] } = useQuery<CategoryDto[]>({
    queryKey: catalogKeys.categories,
    queryFn: fetchCategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: subcategories = [] } = useQuery<SubcategoryDto[]>({
    queryKey: catalogKeys.subcategories,
    queryFn: fetchSubcategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  // Same slot as the waiter preview and the publish bar.
  const { data: draft } = useQuery<MenuTreeDto>({
    queryKey: catalogKeys.draft,
    queryFn: fetchMenuDraft,
    staleTime: ADMIN_LIST_STALE_MS,
  })

  useEffect(() => {
    if (!isError) return
    log.error("Error fetching data:", { error: String(error) })
    toast({
      variant: "destructive",
      title: "Error",
      description: `Error al cargar los datos: ${errorMessage(error)}`,
    })
  }, [isError, error, toast])

  const nodes = useMemo(() => buildAdminMenuTree(categories, subcategories, dishes), [categories, subcategories, dishes])
  const soldOut = useMemo(() => {
    const draftDishes = [...(draft?.categories.flatMap((c) => c.dishes) ?? []), ...(draft?.uncategorized ?? [])]
    return new Set(draftDishes.filter((d) => !d.available).map((d) => d.id))
  }, [draft])

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name
  const subcategoryName = (id: string | null) => subcategories.find((s) => s.id === id)?.name
  const filterName = current.categoryId
    ? [categoryName(current.categoryId), subcategoryName(current.subcategoryId)].filter(Boolean).join(" › ")
    : null
  const inFilter = useMemo(
    () =>
      dishes.filter(
        (dish) =>
          (!current.categoryId || dish.categoryId === current.categoryId) &&
          (!current.subcategoryId || dish.subcategoryId === current.subcategoryId),
      ),
    [dishes, current.categoryId, current.subcategoryId],
  )
  const filteredDishes = useMemo(
    () => inFilter.filter((dish) => dish.name.toLowerCase().includes(searchTerm.toLowerCase())),
    [inFilter, searchTerm],
  )

  const { currentPage, setCurrentPage, itemsPerPage, setItemsPerPage, totalPages, paginatedData } = usePagination({
    data: filteredDishes,
    initialItemsPerPage: 10,
  })

  const handleDelete = async () => {
    const selectedDish = toDelete
    if (!selectedDish) return

    try {
      await deleteDish(selectedDish.id)

      toast({
        title: "Plato eliminado",
        description: `El plato ${selectedDish.name} ha sido eliminado correctamente.`,
      })

      // A recipe change can touch a dish's cost/availability too.
      void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
    } catch (error) {
      log.error("Error deleting dish:", { error: String(error) })
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al eliminar el plato: ${errorMessage(error)}`,
      })
    } finally {
      setToDelete(null)
    }
  }

  const path = (dish: DishDto) => {
    const sub = subcategoryName(dish.subcategoryId)
    if (current.categoryId) return sub ?? "Sin subcategoría"
    const cat = categoryName(dish.categoryId)
    return cat ? [cat, sub].filter(Boolean).join(" › ") : "Sin categoría"
  }
  const openFormula = () => onNavigate?.("formulas")

  return (
    <section aria-labelledby="dish-list-title" className="min-w-0 space-y-3 rounded-card border border-line bg-surface p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="dish-list-title" className="break-words text-base font-semibold [overflow-wrap:anywhere]">
            {filterName ? `Platos de ${filterName}` : "Todos los platos"}
          </h2>
          <p className="text-sm tabular-nums text-muted-fg">{inFilter.length ? plural(inFilter.length, "plato", "platos") : "Sin platos"}</p>
        </div>
        <Button type="button" className={cn("min-h-11", focusRing)} onClick={() => setDialog({ dish: null })}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Nuevo plato
        </Button>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg" aria-hidden />
          <Input
            type="search"
            placeholder="Buscar platos..."
            aria-label="Buscar platos"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="min-h-11 pl-9"
          />
        </div>
        <label className="sr-only" htmlFor="dish-list-filter">
          Categoría
        </label>
        <select
          id="dish-list-filter"
          value={filterValue(current)}
          onChange={(e) => changeFilter(parseFilter(e.target.value))}
          className={cn(nativeSelect, "w-full sm:w-auto sm:max-w-[18rem]")}
        >
          <option value="">Todas las categorías ({dishes.length})</option>
          {nodes.map((node) => [
            <option key={node.category.id} value={node.category.id}>
              {node.category.name} ({node.dishCount})
            </option>,
            ...node.subcategories.map(({ subcategory, dishes: own }) => (
              <option key={subcategory.id} value={`${node.category.id}|${subcategory.id}`}>
                {"\u00a0\u00a0\u00a0"}
                {node.category.name} › {subcategory.name} ({own.length})
              </option>
            )),
          ])}
        </select>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-fg">Cargando platos...</p>
      ) : filteredDishes.length === 0 ? (
        <EmptyState
          title={
            searchTerm
              ? "No se encontraron platos con ese término de búsqueda"
              : filterName
                ? `${filterName} aún no tiene platos`
                : "No hay platos registrados"
          }
        />
      ) : (
        <>
          <ul aria-label="Platos" className="divide-y divide-line rounded-xl border border-line bg-card">
            {paginatedData.map((dish) => (
              <DishRow
                key={dish.id}
                dish={dish}
                path={path(dish)}
                soldOut={soldOut.has(dish.id)}
                onFormula={openFormula}
                onEdit={() => setDialog({ dish })}
                onDelete={() => setToDelete(dish)}
              />
            ))}
          </ul>

          <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", tallControls)}>
            <ItemsPerPage itemsPerPage={itemsPerPage} onChange={setItemsPerPage} options={[10, 25, 50, 100]} />
            <div className="text-sm text-muted-fg">
              Mostrando {paginatedData.length} de {filteredDishes.length} platos
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        </>
      )}

      <DishDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        dish={dialog?.dish ?? null}
        categories={categories}
        subcategories={subcategories}
        defaultCategoryId={current.categoryId ?? undefined}
        defaultSubcategoryId={current.subcategoryId ?? undefined}
        soldOut={dialog?.dish ? soldOut.has(dialog.dish.id) : false}
        onOpenFormula={onNavigate ? openFormula : undefined}
        onSaved={() => {
          void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
          setDialog(null)
        }}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente el plato <strong>{toDelete?.name}</strong> y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={handleDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
