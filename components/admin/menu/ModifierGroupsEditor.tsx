"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Layers, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useInventoryItems } from "@/hooks/inventory"
import type { DishDto, ModifierGroupDto } from "@/lib/api/catalog"
import {
  ADMIN_LIST_STALE_MS,
  catalogKeys,
  dishesUsingGroup,
  errorMessage,
  fetchAdminModifierGroups,
  fetchDishes,
} from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { ModifierGroupForm } from "./ModifierGroupForm"
import { RuleChip } from "./ModifierRuleChip"
import { plural } from "./WaiterPreview"

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

/**
 * Menú → Modificadores (F7, design 01): the reusable groups, each with its rule
 * chip, option count and the dishes that offer it, next to the group editor.
 * Below `lg` the editor replaces the list, with a way back.
 */
export function ModifierGroupsEditor() {
  const { toast } = useToast()
  const [selected, setSelected] = useState<string | "new" | null>(null)
  // Bumped on each save, so the editor starts over from the saved group and its new option ids.
  const [version, setVersion] = useState(0)
  const groupsQuery = useQuery<ModifierGroupDto[]>({
    queryKey: catalogKeys.modifierGroups,
    queryFn: fetchAdminModifierGroups,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: dishes = [] } = useQuery<DishDto[]>({
    queryKey: catalogKeys.dishes,
    queryFn: fetchDishes,
    staleTime: ADMIN_LIST_STALE_MS,
  })
  const { data: items = [] } = useInventoryItems()
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])

  useEffect(() => {
    if (!groupsQuery.isError) return
    toast({ variant: "destructive", title: "Error", description: `Error al cargar los modificadores: ${errorMessage(groupsQuery.error)}` })
  }, [groupsQuery.isError, groupsQuery.error, toast])

  const current = selected === "new" ? null : (groups.find((g) => g.id === selected) ?? null)
  const editing = selected === "new" || current !== null

  if (groupsQuery.isLoading) return <p className="py-8 text-center text-sm text-muted-fg">Cargando modificadores...</p>

  if (groups.length === 0 && !editing) {
    return (
      <div className="grid justify-items-center gap-2.5 rounded-card border-[1.5px] border-dashed border-line px-4 py-7 text-center">
        <Layers className="h-8 w-8 text-muted-fg" aria-hidden />
        <h2 className="text-[17px] font-semibold">Aún no hay grupos de modificadores</h2>
        <p className="max-w-[46ch] text-sm text-fg-2">
          Un grupo reúne opciones como “Término de la carne” o “Adiciones”, con su precio. Lo creas una vez y lo asignas a
          varios platos; “Sin cebolla” es una opción de $0.
        </p>
        <Button className="min-h-11" onClick={() => setSelected("new")}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Crear el primer grupo
        </Button>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-6">
      <div className={cn("grid min-w-0 gap-2.5", editing && "max-lg:hidden")}>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Grupos</h2>
          <span className="text-sm tabular-nums text-muted-fg">{plural(groups.length, "grupo", "grupos")}</span>
        </div>
        <p className="text-sm text-muted-fg">Crea un grupo una vez y asígnalo a varios platos.</p>
        <ul aria-label="Grupos de modificadores" className="grid gap-2">
          {groups.map((group) => {
            const isSelected = group.id === selected
            const used = dishesUsingGroup(dishes, group.id).length
            return (
              <li key={group.id} className="min-w-0">
                <button
                  type="button"
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => setSelected(group.id)}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[14px] border border-line bg-card px-3 py-2.5 text-left",
                    isSelected && "border-brand bg-brand-tint shadow-[inset_0_0_0_1px_var(--accent)]",
                    focusRing,
                  )}
                >
                  <span className="grid min-w-0 flex-1 gap-1">
                    <b className="break-words text-[15.5px] font-semibold [overflow-wrap:anywhere]">{group.name}</b>
                    <span className="flex flex-wrap gap-1.5">
                      <RuleChip group={group} />
                      {!group.isActive && <span className="text-xs text-muted-fg">Inactivo</span>}
                    </span>
                    <small className="text-[12.5px] text-muted-fg">
                      {plural(group.options.length, "opción", "opciones")} · en {plural(used, "plato", "platos")}
                    </small>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-fg-2" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
        <Button className="min-h-11" onClick={() => setSelected("new")}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Nuevo grupo
        </Button>
      </div>
      {editing ? (
        <ModifierGroupForm
          key={`${current?.id ?? "new"}-${version}`}
          group={current}
          usedIn={current ? dishesUsingGroup(dishes, current.id) : []}
          ingredients={items}
          onSaved={(id) => {
            setSelected(id)
            setVersion((v) => v + 1)
          }}
          onClose={() => setSelected(null)}
        />
      ) : (
        <p className="hidden rounded-card border border-dashed border-line p-6 text-center text-sm text-muted-fg lg:block">
          Elige un grupo para editarlo o crea uno nuevo.
        </p>
      )}
    </div>
  )
}
