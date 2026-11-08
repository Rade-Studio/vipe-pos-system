"use client"

import { useId, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronLeft, Loader2, Minus, Plus, Trash2 } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { log } from "@/lib/log"
import {
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  deleteModifierOption,
  updateModifierGroup,
  updateModifierOption,
  type CreateModifierOptionBody,
  type DishDto,
  type ModifierGroupDto,
} from "@/lib/api/catalog"
import type { InventoryItem } from "@/lib/api/inventory/types"
import {
  catalogKeys,
  checkModifierGroup,
  errorMessage,
  invalidateCatalogReaders,
  MODIFIER_SELECT_MAX,
  modifierRuleText,
  moveItem,
  optionIngredientQty,
} from "@/lib/admin/catalog"
import { cn } from "@/lib/utils"
import { ModifierOptionRow, type OptionRowDraft } from "./ModifierOptionRow"

const focusRing =
  "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"

interface GroupDraft {
  name: string
  required: boolean
  minSelect: number
  maxSelect: number | null
  options: OptionRowDraft[]
}

let nextKey = 0
const blankOption = (): OptionRowDraft => ({ key: `new-${nextKey++}`, name: "", price: "0", ingredientId: "", ingredientQty: "", linked: false })

function draftOf(group: ModifierGroupDto | null): GroupDraft {
  if (!group) return { name: "", required: false, minSelect: 0, maxSelect: null, options: [] }
  return {
    name: group.name,
    required: group.required,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: [...group.options]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((o) => ({
        key: o.id,
        id: o.id,
        name: o.name,
        price: String(o.price),
        ingredientId: o.ingredientId ?? "",
        ingredientQty: o.ingredientQty === null ? "" : String(o.ingredientQty),
        linked: o.ingredientId !== null,
      })),
  }
}

/** −/+ around a count, 44 px targets; `label` names the field and its buttons. */
function Stepper({ label, value, onMinus, onPlus, minusDisabled, plusDisabled }: {
  label: string
  value: string
  onMinus: () => void
  onPlus: () => void
  minusDisabled: boolean
  plusDisabled: boolean
}) {
  const id = useId()
  const button = cn("grid h-11 w-11 place-items-center rounded-pill text-fg disabled:text-muted-fg disabled:opacity-60", focusRing)
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <span id={id} className="text-[13.5px] font-semibold text-fg-2">
        {label}
      </span>
      <span role="group" aria-labelledby={id} className="inline-flex items-center justify-self-start rounded-pill border border-line bg-card">
        <button type="button" aria-label={`Menos ${label.toLowerCase()}`} disabled={minusDisabled} onClick={onMinus} className={button}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <output aria-live="polite" className="min-w-[4.5rem] px-1 text-center text-[15px] font-semibold tabular-nums">
          {value}
        </output>
        <button type="button" aria-label={`Más ${label.toLowerCase()}`} disabled={plusDisabled} onClick={onPlus} className={button}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </div>
  )
}

const sameOption = (before: ModifierGroupDto["options"][number], body: CreateModifierOptionBody) =>
  before.name === body.name &&
  before.price === body.price &&
  (before.ingredientId ?? null) === body.ingredientId &&
  (before.ingredientQty ?? null) === body.ingredientQty &&
  before.sortOrder === body.sortOrder

/**
 * The editor of one modifier group (F7): name, Obligatorio, Mínimo/Máximo and
 * its options. Saving writes the group, then deletes, creates and updates only
 * the options that changed; the API rules are checked first, in its words.
 */
export function ModifierGroupForm({
  group,
  usedIn,
  ingredients,
  onSaved,
  onClose,
}: {
  group: ModifierGroupDto | null
  /** Dishes that offer the group: a change applies to all of them. */
  usedIn: readonly DishDto[]
  ingredients: readonly InventoryItem[]
  onSaved: (id: string) => void
  onClose: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [draft, setDraft] = useState<GroupDraft>(() => draftOf(group))
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const errors = checkModifierGroup(draft)
  const title = group ? `Editar grupo ${group.name}` : "Nuevo grupo"

  const set = (patch: Partial<GroupDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const setOption = (index: number, patch: Partial<OptionRowDraft>) =>
    setDraft((d) => ({ ...d, options: d.options.map((o, i) => (i === index ? { ...o, ...patch } : o)) }))
  const moveOption = (index: number, delta: -1 | 1) =>
    setDraft((d) => ({ ...d, options: moveItem(d.options, index, index + delta) ?? d.options }))

  const refresh = () =>
    Promise.all([
      invalidateCatalogReaders(queryClient, catalogKeys.modifierGroups),
      queryClient.invalidateQueries({ queryKey: catalogKeys.dishes }),
    ])

  const save = async () => {
    setTried(true)
    if (errors.length > 0) return
    setSaving(true)
    try {
      const body = { name: draft.name.trim(), required: draft.required, minSelect: draft.minSelect, maxSelect: draft.maxSelect }
      const groupId = group ? (await updateModifierGroup(group.id, body), group.id) : (await createModifierGroup(body)).id
      const before = new Map((group?.options ?? []).map((o) => [o.id, o]))
      const kept = new Set(draft.options.map((o) => o.id))
      for (const o of group?.options ?? []) if (!kept.has(o.id)) await deleteModifierOption(o.id)
      for (const [sortOrder, o] of draft.options.entries()) {
        const optionBody = {
          name: o.name.trim(),
          price: Number(o.price.trim()),
          ingredientId: o.ingredientId || null,
          ingredientQty: optionIngredientQty(o),
          sortOrder,
        }
        const saved = o.id ? before.get(o.id) : undefined
        if (!saved) await createModifierOption(groupId, optionBody)
        else if (!sameOption(saved, optionBody)) await updateModifierOption(saved.id, optionBody)
      }
      toast({ title: group ? "Grupo actualizado" : "Grupo creado", description: `${body.name} quedó guardado.` })
      await refresh()
      onSaved(groupId)
    } catch (error) {
      log.error("Error saving the modifier group:", { error: String(error) })
      toast({ variant: "destructive", title: "Error", description: `No se guardó el grupo: ${errorMessage(error)}` })
      void refresh()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!group) return
    try {
      await deleteModifierGroup(group.id)
      toast({ title: "Grupo eliminado", description: `${group.name} ya no se ofrece en ningún plato.` })
      await refresh()
      onClose()
    } catch (error) {
      log.error("Error deleting the modifier group:", { error: String(error) })
      toast({ variant: "destructive", title: "Error", description: `No se eliminó el grupo: ${errorMessage(error)}` })
    }
  }

  return (
    <section aria-label={title} className="grid min-w-0 max-w-[820px] gap-3.5 rounded-card border border-line bg-card p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" className={cn("min-h-11 px-2 lg:hidden", focusRing)} onClick={onClose}>
          <ChevronLeft className="mr-1 h-5 w-5" aria-hidden />
          Grupos
        </Button>
        <h2 className="min-w-0 flex-1 break-words text-lg font-semibold [overflow-wrap:anywhere]">{group ? group.name : "Nuevo grupo"}</h2>
      </div>

      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={nameId} className="text-[13.5px] font-semibold text-fg-2">
          Nombre del grupo
        </label>
        <Input id={nameId} value={draft.name} placeholder="Ej.: Adiciones de hamburguesa" onChange={(e) => set({ name: e.target.value })} className="h-11 text-[15px]" />
        <span className="text-[12.5px] text-muted-fg">Así lo ve el mesero y así sale en la comanda.</span>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={draft.required}
        onClick={() => set(draft.required ? { required: false, minSelect: 0 } : { required: true, minSelect: Math.max(1, draft.minSelect) })}
        className={cn("flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-left", focusRing)}
      >
        <span className="grid min-w-0 gap-0.5">
          <b className="text-[15px] font-semibold">Obligatorio</b>
          <small className="text-[12.5px] text-muted-fg">El mesero no puede agregar el plato sin elegir.</small>
        </span>
        <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-pill bg-line motion-safe:transition-colors", draft.required && "bg-brand")}>
          <span className={cn("absolute left-[3px] top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow motion-safe:transition-transform", draft.required && "translate-x-5")} />
        </span>
      </button>

      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] items-start gap-2.5">
        <Stepper
          label="Mínimo"
          value={String(draft.minSelect)}
          minusDisabled={draft.minSelect <= 0}
          plusDisabled={draft.minSelect >= MODIFIER_SELECT_MAX}
          onMinus={() => set({ minSelect: draft.minSelect - 1 })}
          onPlus={() => set({ minSelect: draft.minSelect + 1 })}
        />
        <div className="flex min-w-0 flex-wrap items-end gap-1.5">
          <Stepper
            label="Máximo"
            value={draft.maxSelect === null ? "Sin límite" : String(draft.maxSelect)}
            minusDisabled={draft.maxSelect === null || draft.maxSelect <= 1}
            plusDisabled={draft.maxSelect !== null && draft.maxSelect >= MODIFIER_SELECT_MAX}
            onMinus={() => set({ maxSelect: (draft.maxSelect ?? 2) - 1 })}
            onPlus={() => set({ maxSelect: draft.maxSelect === null ? Math.max(1, draft.minSelect) : draft.maxSelect + 1 })}
          />
          <Button type="button" variant="ghost" className="min-h-11 px-3" disabled={draft.maxSelect === null} onClick={() => set({ maxSelect: null })}>
            Sin límite
          </Button>
        </div>
      </div>
      <p className="text-[12.5px] text-muted-fg">{modifierRuleText(draft)}</p>

      <div className="grid min-w-0 gap-2">
        <span className="text-[13.5px] font-semibold text-fg-2">Opciones · precio que suma al plato</span>
        {draft.options.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-3 text-sm text-muted-fg">Sin opciones todavía. “Sin cebolla” es una opción de $0.</p>
        ) : (
          <ol aria-label="Opciones del grupo" className="grid gap-2">
            {draft.options.map((option, index) => (
              <ModifierOptionRow
                key={option.key}
                option={option}
                index={index}
                total={draft.options.length}
                ingredients={ingredients}
                onChange={(patch) => setOption(index, patch)}
                onMove={(delta) => moveOption(index, delta)}
                onRemove={() => setRemoving(index)}
              />
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={() => set({ options: [...draft.options, blankOption()] })}
          className={cn("flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-fg-2", focusRing)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Agregar opción
        </button>
      </div>

      {usedIn.length > 1 && (
        <div className="flex min-w-0 gap-2 rounded-xl border border-status-warning-line bg-status-warning-bg p-3 text-[13px] text-status-warning-fg">
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">
            Se usa en {usedIn.length} platos: el cambio aplica en todos. {usedIn.map((dish) => dish.name).join(", ")}.
          </p>
        </div>
      )}

      {tried && errors.length > 0 && (
        <ul role="alert" className="grid gap-1 rounded-xl border border-status-danger-line bg-status-danger-bg p-3 text-[13px] text-status-danger-fg">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2.5 bg-card pt-2">
        {group && (
          <Button type="button" variant="ghost" className="mr-auto min-h-11 text-status-danger-fg" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden />
            Eliminar grupo
          </Button>
        )}
        <Button type="button" variant="outline" className="min-h-11 flex-1 sm:max-w-60" onClick={() => (group ? (setDraft(draftOf(group)), setTried(false)) : onClose())}>
          Descartar
        </Button>
        <Button type="button" className="min-h-11 flex-1 sm:max-w-60" disabled={saving} onClick={() => void save()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Guardar grupo
        </Button>
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la opción {draft.options[removing ?? 0]?.name.trim() || removing! + 1}?</AlertDialogTitle>
            <AlertDialogDescription>Se borra al guardar el grupo. Las líneas ya enviadas conservan la opción.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                if (removing !== null) set({ options: draft.options.filter((_, i) => i !== removing) })
                setRemoving(null)
              }}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el grupo {group?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quita de {usedIn.length === 1 ? "1 plato" : `${usedIn.length} platos`} con sus opciones. Los pedidos ya enviados no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => void remove()}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
