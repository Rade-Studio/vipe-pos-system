"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, GripVertical, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SectionHeader } from "@/components/admin/common/Panel"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import { reorderCategories, reorderDishes, type CategoryDto, type DishDto, type DishGroup, type MenuPublicationDto, type MenuTreeDto } from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"
import {
  ADMIN_LIST_STALE_MS,
  buildAdminMenuTree,
  catalogKeys,
  draftMenuTree,
  errorMessage,
  fetchCategories,
  fetchDishes,
  fetchMenuDraft,
  fetchMenuPublication,
  fetchSubcategories,
  invalidateCatalogReaders,
  invalidateMenuReaders,
  moveItem,
  type AdminCategoryNode,
} from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { CategoryForm } from "./CategoryForm"
import { CategoryInspector } from "./CategoryInspector"
import { DishOrderList } from "./DishOrderList"
import { PublishBar } from "./PublishBar"
import { CategorySwatch } from "./tones"
import { plural, WaiterPreview } from "./WaiterPreview"

/** Tree + inspector side by side from here; below, the inspector is a full-height sheet. */
const INLINE_INSPECTOR_FROM = 1024
/** Gap between category rows (`gap-2`), part of one drag step. */
const ROW_GAP = 8

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

function useWide() {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= INLINE_INSPECTOR_FROM)
  useEffect(() => {
    const update = () => setWide(window.innerWidth >= INLINE_INSPECTOR_FROM)
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return wide
}

const summary = (node: AdminCategoryNode) =>
  node.skipsSubcategoryStep
    ? `Sin subcategorías · ${plural(node.dishCount, "plato", "platos")}`
    : `${plural(node.subcategories.length, "subcategoría", "subcategorías")} · ${plural(node.dishCount, "plato", "platos")}`

interface DishReorder {
  saving: boolean
  onReorder: (group: DishGroup, ids: string[], movedId: string) => void
}

/** The expanded part of a category row: subcategories with their dishes, or the dishes alone. */
function TreeChildren({ node, reorder }: { node: AdminCategoryNode; reorder: DishReorder }) {
  const { category } = node
  const kids = "mt-1.5 ml-[22px] grid gap-1.5 border-l-2 border-line pl-3"
  const loose = (label: string, className?: string) => (
    <DishOrderList
      label={label}
      dishes={node.looseDishes}
      className={className}
      saving={reorder.saving}
      onReorder={(ids, movedId) => reorder.onReorder({ categoryId: category.id, subcategoryId: null }, ids, movedId)}
    />
  )
  if (node.subcategories.length === 0) {
    return node.looseDishes.length === 0 ? (
      <p className={cn(kids, "py-2 text-sm text-muted-fg")}>Sin platos todavía.</p>
    ) : (
      loose(`Platos de ${category.name}`, kids)
    )
  }
  return (
    <ol aria-label={`Subcategorías de ${category.name}`} className={kids}>
      {node.subcategories.map(({ subcategory, dishes }) => (
        <li key={subcategory.id} className="min-w-0">
          <div className="flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-line bg-card px-2 py-1">
            <CategorySwatch color={category.color} icon={category.icon} className="h-7 w-7 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[14.5px] font-medium [overflow-wrap:anywhere]">{subcategory.name}</span>
              <span className="block text-xs text-muted-fg">
                {plural(dishes.length, "plato", "platos")}
                {!subcategory.active && " · Inactiva"}
              </span>
            </span>
          </div>
          {dishes.length > 0 && (
            <DishOrderList
              label={`Platos de ${subcategory.name}`}
              dishes={dishes}
              className="ml-4 mt-1"
              saving={reorder.saving}
              onReorder={(ids, movedId) => reorder.onReorder({ categoryId: category.id, subcategoryId: subcategory.id }, ids, movedId)}
            />
          )}
        </li>
      ))}
      {node.looseDishes.length > 0 && (
        <li className="min-w-0">
          <p className="px-2 pt-1 text-xs font-medium text-muted-fg">Sin subcategoría</p>
          {loose(`Platos de ${category.name} sin subcategoría`, "ml-4 mt-1")}
        </li>
      )}
    </ol>
  )
}

/**
 * The admin Menú tree (redesign T9): categories in the order the waiter sees
 * them (drag the handle or ↑/↓ on it, saved with PUT /catalog/categories/order),
 * expandable to subcategories and dishes; the selected category opens in the
 * inspector next to the waiter preview. Phone: list editing, no drag; the
 * inspector is a full-height sheet.
 *
 * T27: dishes reorder inside their group the same way (PUT /catalog/dishes/order);
 * the waiters get structure edits only through "Publicar a meseros", so the
 * preview reads the draft (GET /catalog/menu/draft).
 */
export function MenuTreeEditor() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const wide = useWide()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [focusHandle, setFocusHandle] = useState<string | null>(null)
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<{ id: string; startY: number; step: number; ids: string[] } | null>(null)

  const categoriesQuery = useQuery<CategoryDto[]>({
    queryKey: catalogKeys.categories,
    queryFn: fetchCategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: subcategories = [] } = useQuery<SubcategoryDto[]>({
    queryKey: catalogKeys.subcategories,
    queryFn: fetchSubcategories,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: dishes = [] } = useQuery<DishDto[]>({
    queryKey: catalogKeys.dishes,
    queryFn: fetchDishes,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: draft } = useQuery<MenuTreeDto>({
    queryKey: catalogKeys.draft,
    queryFn: fetchMenuDraft,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  // Same slot as the publish bar: only the "sin publicar" label of the preview reads it here.
  const { data: publication } = useQuery<MenuPublicationDto>({
    queryKey: catalogKeys.publication,
    queryFn: fetchMenuPublication,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])

  useEffect(() => {
    if (!categoriesQuery.isError) return
    log.error("Error fetching the menu tree:", { error: String(categoriesQuery.error) })
    toast({
      variant: "destructive",
      title: "Error",
      description: `Error al cargar las categorías: ${errorMessage(categoriesQuery.error)}`,
    })
  }, [categoriesQuery.isError, categoriesQuery.error, toast])

  const savedNodes = useMemo(() => buildAdminMenuTree(categories, subcategories, dishes), [categories, subcategories, dishes])
  const nodes = useMemo(() => {
    if (!dragOrder) return savedNodes
    const byId = new Map(savedNodes.map((node) => [node.category.id, node]))
    return dragOrder.map((id) => byId.get(id)).filter((node): node is AdminCategoryNode => Boolean(node))
  }, [savedNodes, dragOrder])

  // Wide screens always show a category in the inspector: the first one by default.
  const effectiveId = selectedId ?? (wide ? (nodes[0]?.category.id ?? null) : null)
  const selectedIndex = nodes.findIndex((node) => node.category.id === effectiveId)
  const selected = selectedIndex >= 0 ? nodes[selectedIndex] : null

  // The preview is what the next publication serves; until the draft arrives, the saved lists stand in.
  const previewNodes = useMemo(() => (draft ? draftMenuTree(draft) : nodes), [draft, nodes])
  const previewSelected = selected ? (previewNodes.find((node) => node.category.id === selected.category.id) ?? selected) : null
  const unpublished = (publication?.pendingChanges ?? 0) > 0
  const preview = <WaiterPreview nodes={previewNodes} selected={previewSelected} unpublished={unpublished} />

  useEffect(() => {
    if (!focusHandle) return
    handles.current.get(focusHandle)?.focus()
    setFocusHandle(null)
  }, [focusHandle, nodes])

  /** Saves `ids` as the menu order; the list shows it at once and goes back to the saved one on a refusal. */
  const saveOrder = async (ids: string[], movedId: string) => {
    const previous = queryClient.getQueryData<CategoryDto[]>(catalogKeys.categories)
    const position = new Map(ids.map((id, index) => [id, index]))
    queryClient.setQueryData<CategoryDto[]>(catalogKeys.categories, (rows: CategoryDto[] = []) =>
      rows.map((row) => (position.has(row.id) ? { ...row, sortOrder: position.get(row.id)! } : row)),
    )
    const moved = previous?.find((row) => row.id === movedId)
    setAnnouncement(`${moved?.name ?? "Categoría"} movida a la posición ${position.get(movedId)! + 1} de ${ids.length}`)
    setSaving(true)
    try {
      const saved = await reorderCategories(ids)
      const byId = new Map(saved.map((row) => [row.id, row]))
      queryClient.setQueryData<CategoryDto[]>(catalogKeys.categories, (rows: CategoryDto[] = []) => rows.map((row) => byId.get(row.id) ?? row))
      void invalidateMenuReaders(queryClient)
    } catch (error) {
      log.error("Error saving the category order:", { error: String(error) })
      toast({ variant: "destructive", title: "Error", description: `No se guardó el orden: ${errorMessage(error)}` })
      setAnnouncement("No se guardó el orden")
      void invalidateCatalogReaders(queryClient, catalogKeys.categories)
    } finally {
      setSaving(false)
    }
  }

  /** Saves `ids` as the order of one dish group; shown at once, the previous order comes back on a refusal. */
  const saveDishOrder = async (group: DishGroup, ids: string[], movedId: string) => {
    const previous = queryClient.getQueryData<DishDto[]>(catalogKeys.dishes)
    const position = new Map(ids.map((id, index) => [id, index]))
    queryClient.setQueryData<DishDto[]>(catalogKeys.dishes, (rows: DishDto[] = []) =>
      rows.map((row) => (position.has(row.id) ? { ...row, sortOrder: position.get(row.id)! } : row)),
    )
    const moved = previous?.find((row) => row.id === movedId)
    setAnnouncement(`${moved?.name ?? "Plato"} movido a la posición ${position.get(movedId)! + 1} de ${ids.length}`)
    setSaving(true)
    try {
      const saved = await reorderDishes(group, ids)
      const byId = new Map(saved.map((row) => [row.id, row]))
      queryClient.setQueryData<DishDto[]>(catalogKeys.dishes, (rows: DishDto[] = []) => rows.map((row) => byId.get(row.id) ?? row))
      void invalidateMenuReaders(queryClient)
    } catch (error) {
      log.error("Error saving the dish order:", { error: String(error) })
      if (previous) queryClient.setQueryData(catalogKeys.dishes, previous)
      toast({ variant: "destructive", title: "Error", description: `No se guardó el orden: ${errorMessage(error)}` })
      setAnnouncement("No se guardó el orden")
      void invalidateCatalogReaders(queryClient, catalogKeys.dishes)
    } finally {
      setSaving(false)
    }
  }
  const dishReorder: DishReorder = { saving, onReorder: (group, ids, movedId) => void saveDishOrder(group, ids, movedId) }

  const moveCategory = (id: string, delta: number, focus = true) => {
    const ids = nodes.map((node) => node.category.id)
    const from = ids.indexOf(id)
    const next = moveItem(ids, from, from + delta)
    if (!next) return
    if (focus) setFocusHandle(id)
    void saveOrder(next, id)
  }

  const onHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    if (saving) return
    moveCategory(id, event.key === "ArrowUp" ? -1 : 1)
  }

  // Pointer drag on the handle: the row follows in whole steps (row height +
  // gap); the order is saved once, on release.
  const onHandlePointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (saving || event.button !== 0) return
    const row = event.currentTarget.closest("li")
    if (!row) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const ids = nodes.map((node) => node.category.id)
    drag.current = { id, startY: event.clientY, step: row.getBoundingClientRect().height + ROW_GAP, ids }
    setDraggingId(id)
    setDragOrder(ids)
  }
  const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    if (!state || state.step <= 0) return
    const steps = Math.round((event.clientY - state.startY) / state.step)
    if (!steps) return
    const from = state.ids.indexOf(state.id)
    const to = Math.max(0, Math.min(state.ids.length - 1, from + steps))
    const next = moveItem(state.ids, from, to)
    if (!next) return
    drag.current = { ...state, ids: next, startY: state.startY + (to - from) * state.step }
    setDragOrder(next)
  }
  const onHandlePointerUp = () => {
    const state = drag.current
    drag.current = null
    setDraggingId(null)
    setDragOrder(null)
    if (!state) return
    const before = savedNodes.map((node) => node.category.id)
    if (state.ids.join() !== before.join()) {
      setFocusHandle(state.id)
      void saveOrder(state.ids, state.id)
    }
  }

  const select = (id: string) => {
    setSelectedId(id)
    if (!wide) setSheetOpen(true)
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const inspector = selected && (
    <CategoryInspector
      key={selected.category.id}
      node={selected}
      position={selectedIndex + 1}
      total={nodes.length}
      categories={categories}
      subcategories={subcategories}
      moving={saving}
      onMove={(delta) => moveCategory(selected.category.id, delta, false)}
      onDeleted={() => {
        setSelectedId(null)
        setSheetOpen(false)
      }}
    />
  )

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Menú para meseros"
        description="Categorías, subcategorías y platos en el orden y los colores de la toma de pedidos."
        actions={
          <Button className="min-h-11" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Nueva categoría
          </Button>
        }
      />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {/* Phone: last in the section and stuck to the bottom of the screen while the tree scrolls. */}
      <PublishBar className="z-20 max-md:sticky max-md:bottom-0 max-md:order-last max-md:bg-canvas max-md:pb-2 max-md:pt-1" />

      {categoriesQuery.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Cargando categorías...</p>
      ) : nodes.length === 0 ? (
        <EmptyState title="No hay categorías registradas" />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] min-[1440px]:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(17rem,22rem)]">
          <div className="min-w-0 space-y-2 lg:row-span-2 lg:self-start lg:rounded-card min-[1440px]:row-span-1 lg:border lg:border-line lg:bg-surface lg:p-3">
            <h2 className="text-base font-semibold">Categorías</h2>
            <p className="text-sm text-muted-fg">
              <span className="hidden md:inline">Arrastra con el asa o usa ↑ ↓ sobre ella. </span>
              <span className="md:hidden">Toca una categoría para editarla y moverla. </span>
              Este es el orden que el mesero ve siempre, en la misma posición.
            </p>
            <ol aria-label="Categorías" className="grid gap-2">
              {nodes.map((node, index) => {
                const { category } = node
                const isSelected = category.id === effectiveId
                const isOpen = expanded.has(category.id)
                return (
                  <li key={category.id} className="min-w-0">
                    <div
                      className={cn(
                        "flex min-h-14 min-w-0 items-center gap-1.5 rounded-[14px] border border-line bg-card py-1 pl-1 pr-1.5",
                        isSelected && "border-brand bg-brand-tint shadow-[inset_0_0_0_1px_var(--accent)]",
                        draggingId === category.id &&
                          "relative z-10 shadow-[0_16px_30px_-12px_rgba(0,0,0,.5),0_0_0_2px_var(--accent)] motion-safe:scale-[1.015]",
                      )}
                    >
                      <button
                        type="button"
                        ref={(element) => {
                          if (element) handles.current.set(category.id, element)
                          else handles.current.delete(category.id)
                        }}
                        aria-label={`Mover ${category.name}, posición ${index + 1} de ${nodes.length}`}
                        aria-roledescription="asa para reordenar"
                        aria-describedby="menu-tree-handle-help"
                        onKeyDown={(event) => onHandleKeyDown(event, category.id)}
                        onPointerDown={(event) => onHandlePointerDown(event, category.id)}
                        onPointerMove={onHandlePointerMove}
                        onPointerUp={onHandlePointerUp}
                        onPointerCancel={onHandlePointerUp}
                        className={cn(
                          "hidden h-11 w-11 shrink-0 cursor-grab touch-none place-items-center rounded-[10px] text-muted-fg active:cursor-grabbing md:grid",
                          focusRing,
                        )}
                      >
                        <GripVertical className="h-5 w-5" aria-hidden />
                      </button>
                      <span aria-hidden className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-fg">
                        {index + 1}
                      </span>
                      <CategorySwatch color={category.color} icon={category.icon} />
                      <button
                        type="button"
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => select(category.id)}
                        className={cn(
                          "flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-1 py-1.5 text-left",
                          focusRing,
                        )}
                      >
                        <b data-category-name className="break-words text-[15.5px] font-semibold leading-tight [overflow-wrap:anywhere]">
                          {category.name}
                        </b>
                        <span className="break-words text-[12.5px] text-muted-fg [overflow-wrap:anywhere]">
                          {summary(node)}
                          {!category.active && " · Inactiva"}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Contraer" : "Expandir"} ${category.name}`}
                        onClick={() => toggle(category.id)}
                        className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-fg-2", focusRing)}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn("h-[18px] w-[18px] motion-safe:transition-transform", isOpen && "rotate-90")}
                        />
                      </button>
                    </div>
                    {isOpen && <TreeChildren node={node} reorder={dishReorder} />}
                  </li>
                )
              })}
            </ol>
            <p id="menu-tree-handle-help" className="sr-only">
              Usa las flechas arriba y abajo para mover la categoría; el orden se guarda al instante.
            </p>
            <p id="menu-tree-dish-handle-help" className="sr-only">
              Usa las flechas arriba y abajo para mover el plato dentro de su grupo; el orden se guarda al instante.
            </p>
          </div>

          {wide && selected && (
            <>
              <div className="min-w-0 rounded-card border border-line bg-card p-4">{inspector}</div>
              <div className="min-w-0 lg:col-start-2 min-[1440px]:col-start-auto">
                {preview}
              </div>
            </>
          )}
          {!wide && preview}
        </div>
      )}

      {!wide && (
        <Sheet open={sheetOpen && Boolean(selected)} onOpenChange={setSheetOpen}>
          <SheetContent
            side="right"
            aria-describedby={undefined}
            // The stock close "X" is under 44 px; the back button below replaces it.
            className="w-full overflow-y-auto p-4 sm:max-w-xl [&>button.absolute]:hidden"
            onOpenAutoFocus={(event) => {
              // Land on the category name, as the design does, not on "Subir".
              event.preventDefault()
              if (selected) document.getElementById(`inspector-${selected.category.id}`)?.focus()
            }}
          >
            <SheetHeader className="flex-row items-center gap-2 space-y-0 text-left">
              <Button type="button" variant="ghost" className={cn("min-h-11 px-3", focusRing)} onClick={() => setSheetOpen(false)}>
                <ChevronLeft className="mr-1 h-5 w-5" aria-hidden />
                Categorías
              </Button>
              <SheetTitle className="min-w-0 truncate text-sm font-normal text-muted-fg">Editar categoría</SheetTitle>
            </SheetHeader>
            <div className="space-y-6 pt-4">
              {inspector}
              {preview}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Nueva Categoría</DialogTitle>
          </DialogHeader>
          <CategoryForm
            category={null}
            onSuccess={() => {
              void invalidateCatalogReaders(queryClient, catalogKeys.categories)
              setCreating(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}
