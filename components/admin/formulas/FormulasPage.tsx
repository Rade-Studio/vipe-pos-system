"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { FlaskConical } from "lucide-react"
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { defaultQuantity } from "@/components/admin/inventory-shared"
import { useCreatePreparation, useSaveFormula } from "@/hooks/inventory"
import { useToast } from "@/hooks/use-toast"
import { toInventoryError } from "@/lib/inventory/errors"
import { formulaCost, priceMetrics, type FormulaItem } from "@/lib/inventory/formula"
import {
  anyLevelDirty,
  currentLevel,
  formulaEditorReducer,
  initialEditorState,
  isLevelDirty,
  openTargetIds,
  type EditorTarget,
} from "@/lib/inventory/formula-editor"
import type { InventoryItem } from "@/lib/supabase/inventory/types"
import { useConfigStore } from "@/store/use-config-store"
import { CreatePreparationDialog } from "./CreatePreparationDialog"
import { FormulaEditor, type CopySource } from "./FormulaEditor"
import { FormulaList, type FormulaListRow } from "./FormulaList"
import { costedItems, prepFormulaMap, useFormulaData } from "./use-formula-data"

interface FormulasPageProps {
  description: string
  onNavigate?: (sectionId: string) => void
}

interface PendingConfirm {
  title: string
  description: string
  onConfirm: () => void
}

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

/**
 * Formula builder (S3, S4): dishes and preparations on the left, the editor on
 * the right (a full-screen sheet below 768 px). Preparations created from the
 * search open nested on top of the current formula and return to it, added,
 * once saved.
 */
export function FormulasPage({ description, onNavigate }: FormulasPageProps) {
  const { items: loadedItems, formulas, dishes, isLoading } = useFormulaData()
  const saveFormula = useSaveFormula()
  const createPreparation = useCreatePreparation()
  const priceSuggestion = useConfigStore((s) => s.priceSuggestion)
  const { toast } = useToast()
  const isMobile = useIsMobile()

  const [state, dispatch] = useReducer(formulaEditorReducer, initialEditorState)
  const [tab, setTab] = useState<"dish" | "prep">("dish")
  const [search, setSearch] = useState("")
  const [createName, setCreateName] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  // Preparations created here before the items query refetches them.
  const [createdItems, setCreatedItems] = useState<InventoryItem[]>([])

  const level = currentLevel(state)
  const root = state.stack[0]

  const items = useMemo(() => {
    const known = new Set(loadedItems.map((item) => item.id))
    return [...loadedItems, ...createdItems.filter((item) => !known.has(item.id))].filter((item) => item.isActive !== false)
  }, [loadedItems, createdItems])

  // Saved prep formulas, overridden by the drafts open in the stack.
  const prepFormulas = useMemo(() => {
    const map = prepFormulaMap(formulas)
    for (const open of state.stack) {
      if (open.target.type === "prep") map.set(open.target.id, { yieldQuantity: open.yieldQuantity, lines: open.lines })
    }
    return map
  }, [formulas, state.stack])

  const itemsById = useMemo(() => costedItems(items as FormulaItem[], prepFormulas), [items, prepFormulas])
  const savedItemsById = useMemo(
    () => costedItems(items as FormulaItem[], prepFormulaMap(formulas)),
    [items, formulas],
  )

  const dishPrice = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish.price])), [dishes])

  const rows = useMemo<FormulaListRow[]>(() => {
    const needle = fold(search.trim())
    const dirtyRoot = root && isLevelDirty(root) ? root.target.id : null
    if (tab === "dish") {
      return dishes
        .filter((dish) => !needle || fold(dish.name).includes(needle))
        .map((dish) => {
          const formula = formulas.byDish[dish.id]
          if (!formula) return { id: dish.id, type: "dish", name: dish.name, cost: null, marginPct: null, dirty: dirtyRoot === dish.id }
          const cost = formulaCost(formula.lines, savedItemsById, formula.yieldQuantity).perUnit
          return {
            id: dish.id,
            type: "dish",
            name: dish.name,
            cost,
            marginPct: dish.price > 0 ? priceMetrics(cost, dish.price, priceSuggestion).marginPct : null,
            dirty: dirtyRoot === dish.id,
          }
        })
    }
    return items
      .filter((item) => item.kind === "prep" && (!needle || fold(item.name).includes(needle) || fold(item.sku).includes(needle)))
      .map((item) => ({
        id: item.id,
        type: "prep",
        name: item.name,
        unit: item.unit,
        cost: formulas.byPrep[item.id] ? savedItemsById.get(item.id)?.cost ?? 0 : null,
        marginPct: null,
        dirty: dirtyRoot === item.id,
      }))
  }, [tab, search, dishes, items, formulas, savedItemsById, priceSuggestion, root])

  const counts = useMemo(
    () => ({ dish: dishes.length, prep: items.filter((item) => item.kind === "prep").length }),
    [dishes, items],
  )

  const copySources = useMemo<CopySource[]>(() => {
    const exclude = new Set(openTargetIds(state))
    const nameOfItem = new Map(items.map((item) => [item.id, item.name]))
    const dishSources = dishes
      .filter((dish) => formulas.byDish[dish.id]?.lines.length && !exclude.has(dish.id))
      .map((dish) => ({ id: dish.id, type: "dish" as const, name: dish.name, lines: formulas.byDish[dish.id].lines }))
    const prepSources = Object.values(formulas.byPrep)
      .filter((formula) => formula.lines.length && !exclude.has(formula.targetId) && nameOfItem.has(formula.targetId))
      .map((formula) => ({
        id: formula.targetId,
        type: "prep" as const,
        name: nameOfItem.get(formula.targetId) as string,
        lines: formula.lines,
      }))
    return [...dishSources, ...prepSources]
  }, [dishes, items, formulas, state])

  const loadedFormula = useCallback(
    (target: { type: "dish" | "prep"; id: string }) =>
      (target.type === "dish" ? formulas.byDish[target.id] : formulas.byPrep[target.id]) ?? null,
    [formulas],
  )

  const guard = (dirty: boolean, title: string, run: () => void) => {
    if (!dirty) return run()
    setConfirm({ title, description: "Los cambios sin guardar se perderán.", onConfirm: run })
  }

  const selectRow = (row: FormulaListRow) => {
    if (root?.target.id === row.id) return
    const target: EditorTarget = { type: row.type, id: row.id, name: row.name }
    guard(anyLevelDirty(state), `¿Descartar los cambios de «${root?.target.name}»?`, () =>
      dispatch({ type: "open", target, formula: loadedFormula(target) }),
    )
  }

  const popLevel = useCallback(() => {
    const top = currentLevel(state)
    if (!top || state.stack.length < 2) return
    guard(isLevelDirty(top), `¿Descartar los cambios de «${top.target.name}»?`, () =>
      dispatch({ type: "pop", saved: false }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const closeMobileEditor = () => {
    guard(anyLevelDirty(state), "¿Cerrar sin guardar?", () => dispatch({ type: "close" }))
  }

  const save = useCallback(async () => {
    const top = currentLevel(state)
    if (!top || saveFormula.isPending) return
    try {
      await saveFormula.mutateAsync({
        targetType: top.target.type,
        targetId: top.target.id,
        yieldQuantity: top.yieldQuantity,
        lines: top.lines,
      })
      dispatch({ type: "saved" })
      toast({ title: "Fórmula guardada", description: top.target.name })
      if (state.stack.length > 1) dispatch({ type: "pop", saved: true })
    } catch (error) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: toInventoryError(error).message })
    }
  }, [state, saveFormula, toast])

  const handleCreate = async ({ name, unit }: { name: string; unit: string }) => {
    try {
      const created = await createPreparation.mutateAsync({ name, unit })
      setCreatedItems((prev) => [...prev, created])
      setCreateName(null)
      dispatch({
        type: "push",
        target: { type: "prep", id: created.id, name: created.name },
        formula: null,
        addToParent: defaultQuantity(created.unit),
      })
    } catch (error) {
      toast({ variant: "destructive", title: "No se pudo crear", description: toInventoryError(error).message })
    }
  }

  const editPrep = (item: FormulaItem) =>
    dispatch({
      type: "push",
      target: { type: "prep", id: item.id, name: item.name },
      formula: loadedFormula({ type: "prep", id: item.id }),
    })

  // Ctrl/Cmd+S saves the visible level; Esc closes a nested level (desktop —
  // the mobile sheet routes Esc itself).
  const dialogOpen = createName !== null || confirm !== null
  const handlers = useRef({ save, popLevel })
  handlers.current = { save, popLevel }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (!dialogOpen) void handlers.current.save()
        return
      }
      if (event.key === "Escape" && !isMobile && !dialogOpen && !event.defaultPrevented) handlers.current.popLevel()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [dialogOpen, isMobile])

  const editorOpen = !!level
  const editor = editorOpen && level && (
    <FormulaEditor
      level={level}
      trail={state.stack.map((open) => open.target.name)}
      openIds={openTargetIds(state)}
      focusLineId={state.focusLineId}
      dispatch={dispatch}
      items={items}
      itemsById={itemsById}
      prepFormulas={prepFormulas}
      price={level.target.type === "dish" ? dishPrice.get(level.target.id) ?? 0 : undefined}
      priceSuggestion={priceSuggestion}
      copySources={copySources}
      saving={saveFormula.isPending}
      onSave={() => void save()}
      onBack={state.stack.length > 1 ? popLevel : undefined}
      onCreatePrep={setCreateName}
      onEditPrep={editPrep}
      onNavigate={onNavigate}
    />
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Fórmulas" description={description} />
      <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="min-w-0" aria-label="Platos y preparaciones">
          <FormulaList
            tab={tab}
            onTabChange={setTab}
            search={search}
            onSearchChange={setSearch}
            rows={rows}
            selectedId={editorOpen ? root?.target.id ?? null : null}
            onSelect={selectRow}
            isLoading={isLoading}
            counts={counts}
          />
        </aside>
        {!isMobile && (
          <section className="min-w-0" aria-label="Editor de fórmula">
            {editor || (
              <EmptyState
                icon={FlaskConical}
                title="Selecciona un plato o una preparación"
                description="Arma su fórmula buscando ingredientes con el teclado; los costos y el margen se calculan al instante."
              />
            )}
          </section>
        )}
      </div>

      {isMobile && (
        <Sheet open={editorOpen} onOpenChange={(open) => !open && closeMobileEditor()}>
          <SheetContent
            side="right"
            className="w-full overflow-y-auto p-4 sm:max-w-full"
            onEscapeKeyDown={(event) => {
              event.preventDefault()
              if (state.stack.length > 1) popLevel()
              else closeMobileEditor()
            }}
          >
            <SheetTitle className="sr-only">Editor de fórmula</SheetTitle>
            <SheetDescription className="sr-only">{level?.target.name}</SheetDescription>
            <div className="pt-6">{editor}</div>
          </SheetContent>
        </Sheet>
      )}

      <CreatePreparationDialog
        initialName={createName}
        creating={createPreparation.isPending}
        onCancel={() => setCreateName(null)}
        onCreate={(input) => void handleCreate(input)}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.onConfirm()
                setConfirm(null)
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
