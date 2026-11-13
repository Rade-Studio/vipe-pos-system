"use client"

import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  daypartErrors,
  saveDayparts,
  type CartaAdminCategory,
  type CartaAdminDaypart,
  type CartaAdminDish,
  type DaypartDraft,
} from "@/lib/api/carta-admin"
import { ApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"
import { inputClass, ToggleChip } from "./parts"

const MAX_DAYPARTS = 12

const toDraft = (daypart: CartaAdminDaypart): DaypartDraft => ({
  name: daypart.name,
  nameEn: daypart.nameEn,
  startsAt: daypart.startsAt,
  endsAt: daypart.endsAt,
  featuredDishId: daypart.featuredDishId,
  categoryIds: daypart.categoryIds,
})

/**
 * Franjas (S17): name, English name, from–to on the same day (the API refuses
 * crossing midnight, T1 A3), categories and the "Plato del día". The whole
 * list is saved at once with PUT dayparts.
 */
export function DaypartsEditor({
  dayparts,
  categories,
  dishes,
  onSaved,
}: {
  dayparts: CartaAdminDaypart[]
  categories: CartaAdminCategory[]
  dishes: CartaAdminDish[]
  onSaved: (dayparts: CartaAdminDaypart[]) => void
}) {
  const { toast } = useToast()
  const [drafts, setDrafts] = useState<DaypartDraft[]>(() => dayparts.map(toDraft))
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const errors = checked ? daypartErrors(drafts) : {}
  const dirty = JSON.stringify(drafts) !== JSON.stringify(dayparts.map(toDraft))

  const change = (index: number, patch: Partial<DaypartDraft>) => {
    setApiError(null)
    setDrafts((list) => list.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
  }

  const toggleCategory = (index: number, categoryId: string) => {
    const current = drafts[index].categoryIds
    const next = current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]
    // Menu order, as the API stores them.
    change(index, { categoryIds: categories.map((c) => c.id).filter((id) => next.includes(id)) })
  }

  const save = async () => {
    setChecked(true)
    if (Object.keys(daypartErrors(drafts)).length > 0) return
    setSaving(true)
    try {
      const saved = await saveDayparts(drafts)
      onSaved(saved)
      setDrafts(saved.map(toDraft))
      setChecked(false)
      toast({ title: "Franjas guardadas" })
    } catch (error) {
      setApiError(error instanceof ApiError ? error.message : "No se pudieron guardar las franjas. Intenta de nuevo.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium leading-none">Franjas del día</p>
        <p className="text-sm text-muted-foreground">Fuera de horario la carta se ve, pero no se puede pedir.</p>
      </div>

      {drafts.length === 0 && <p className="text-sm text-muted-foreground">Sin franjas: la carta muestra todo el menú.</p>}

      <ol className="space-y-3">
        {drafts.map((draft, index) => {
          const n = index + 1
          const error = errors[index]
          return (
            <li key={index} className={cn("space-y-3 rounded-md border p-3", error && "border-destructive")}>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input
                  aria-label={`Nombre de la franja ${n}`}
                  placeholder="Desayuno"
                  maxLength={40}
                  value={draft.name}
                  onChange={(event) => change(index, { name: event.target.value })}
                  className={inputClass}
                />
                <input
                  aria-label={`Nombre en inglés (franja ${n})`}
                  placeholder="Breakfast"
                  maxLength={40}
                  value={draft.nameEn ?? ""}
                  onChange={(event) => change(index, { nameEn: event.target.value })}
                  className={inputClass}
                />
                <input
                  type="time"
                  aria-label={`Desde (franja ${n})`}
                  value={draft.startsAt}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => change(index, { startsAt: event.target.value })}
                  className={inputClass}
                />
                <input
                  type="time"
                  aria-label={`Hasta (franja ${n})`}
                  value={draft.endsAt}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => change(index, { endsAt: event.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Categorías de la franja ${n}`}>
                {categories.map((category) => (
                  <ToggleChip
                    key={category.id}
                    label={`${category.name} en franja ${n}`}
                    pressed={draft.categoryIds.includes(category.id)}
                    onClick={() => toggleCategory(index, category.id)}
                  >
                    {category.name}
                  </ToggleChip>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <select
                  aria-label={`Plato del día (franja ${n})`}
                  value={draft.featuredDishId ?? ""}
                  onChange={(event) => change(index, { featuredDishId: event.target.value || null })}
                  className={cn(inputClass, "sm:max-w-xs")}
                >
                  <option value="">Sin plato del día</option>
                  {dishes.map((dish) => (
                    <option key={dish.id} value={dish.id}>
                      {dish.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Quitar franja ${n}`}
                  onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Quitar
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </li>
          )
        })}
      </ol>

      {apiError && <p className="text-sm text-destructive">{apiError}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={drafts.length >= MAX_DAYPARTS}
          onClick={() =>
            setDrafts((list) => [...list, { name: "", nameEn: null, startsAt: "12:00", endsAt: "15:00", featuredDishId: null, categoryIds: [] }])
          }
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Agregar franja
        </Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar franjas
        </Button>
      </div>
    </div>
  )
}
