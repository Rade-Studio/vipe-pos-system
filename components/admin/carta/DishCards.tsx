"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { CartaAdminCategory, CartaAdminDish, CartaDishDetails, DishTag } from "@/lib/api/carta-admin"
import { formatCop } from "@/lib/carta/format"
import { TAG_LABELS } from "@/lib/carta/i18n"
import { cn } from "@/lib/utils"
import { DishTableFooter, DishTableToolbar, saveEach, useDishFilter, type DishStatus } from "./DishTable"
import { CartaCard, StaticChip, SwitchRow, ToggleChip } from "./parts"

/** "Lo más pedido" is computed by the API from sales, so it is not an editable tag. */
const TAGS = Object.keys(TAG_LABELS.es).filter((tag) => tag !== "most_ordered") as DishTag[]

export interface DishDraftProps {
  dishes: CartaAdminDish[]
  categories?: CartaAdminCategory[]
  drafts: Record<string, CartaDishDetails>
  /** Dishes with unsaved edits in this card's fields. */
  dirtyIds: ReadonlySet<string>
  savingId: string | null
  onChange: (dishId: string, patch: Partial<CartaDishDetails>) => void
  onSave: (dishId: string) => Promise<void>
}

const draftOf = (dish: CartaAdminDish, drafts: DishDraftProps["drafts"]): CartaDishDetails =>
  drafts[dish.id] ?? { tags: dish.tags, descriptionEn: dish.descriptionEn, descriptionEnReviewed: dish.descriptionEnReviewed }

/** Row save: only shown once the row has unsaved changes. */
function SaveDish({ dishId, dirtyIds, savingId, onSave }: Pick<DishDraftProps, "dirtyIds" | "savingId" | "onSave"> & { dishId: string }) {
  if (!dirtyIds.has(dishId) && savingId !== dishId) return <span className="hidden w-[5.5rem] md:block" aria-hidden />
  return (
    <Button type="button" size="sm" variant="outline" className="h-8 w-[5.5rem]" disabled={savingId !== null} onClick={() => void onSave(dishId)}>
      {savingId === dishId && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
      Guardar
    </Button>
  )
}

/** Bulk save of the dirty dishes this card shows, one at a time. */
function useSaveAll(dishes: CartaAdminDish[], dirtyIds: ReadonlySet<string>, onSave: DishDraftProps["onSave"]) {
  const [saving, setSaving] = useState(false)
  const ids = dishes.filter((dish) => dirtyIds.has(dish.id)).map((dish) => dish.id)
  const saveAll = async () => {
    setSaving(true)
    try {
      await saveEach(ids, onSave)
    } finally {
      setSaving(false)
    }
  }
  return { ids, saving, saveAll }
}

type TagStatus = "all" | "tagged" | "untagged" | "paused"

/** Platos y etiquetas: tag chips per dish; "Lo más pedido" is computed by the API. */
export function DishesCard({ dishes, categories, drafts, dirtyIds, savingId, onChange, onSave }: DishDraftProps) {
  const tagsOf = (dish: CartaAdminDish) => draftOf(dish, drafts).tags
  const statuses: DishStatus<TagStatus>[] = [
    { key: "all", label: "Todos", match: () => true },
    { key: "tagged", label: "Con etiquetas", match: (d) => tagsOf(d).length > 0 },
    { key: "untagged", label: "Sin etiquetas", match: (d) => tagsOf(d).length === 0 },
    { key: "paused", label: "Pausados", match: (d) => !d.active },
  ]
  const filter = useDishFilter(dishes, statuses)
  const bulk = useSaveAll(dishes, dirtyIds, onSave)

  return (
    <CartaCard id="carta-platos" title="Platos y etiquetas" description="Toca una etiqueta para ponerla o quitarla.">
      <DishTableToolbar
        filter={filter}
        statuses={statuses}
        categories={categories}
        dirtyCount={bulk.ids.length}
        saving={bulk.saving || savingId !== null}
        onSaveAll={() => void bulk.saveAll()}
      />
      {filter.visible.length > 0 && (
        <ul className="divide-y rounded-md border">
          {filter.visible.map((dish) => {
            const tags = draftOf(dish, drafts).tags
            return (
              <li key={dish.id}>
                <div
                  role="group"
                  aria-label={`Etiquetas de ${dish.name}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 md:flex-nowrap"
                >
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm md:max-w-[18rem]">
                    <span className="truncate font-medium">{dish.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatCop(dish.price)}</span>
                    {dish.mostOrdered && <StaticChip tone="ok"><span className="whitespace-nowrap">★ Lo más pedido</span></StaticChip>}
                    {!dish.active && <StaticChip tone="warn">Pausado</StaticChip>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 md:flex-1">
                    {TAGS.map((tag) => (
                      <ToggleChip
                        key={tag}
                        pressed={tags.includes(tag)}
                        onClick={() => onChange(dish.id, { tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] })}
                      >
                        {TAG_LABELS.es[tag]}
                      </ToggleChip>
                    ))}
                  </div>
                  <SaveDish dishId={dish.id} dirtyIds={dirtyIds} savingId={savingId} onSave={onSave} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <DishTableFooter total={dishes.length} filter={filter} />
      <p className="text-sm text-muted-foreground">
        “Lo más pedido” se calcula solo con las ventas de los últimos 30 días. “Agotado” también es automático: sale del inventario o
        de la producción del día, no hay que marcarlo aquí.
      </p>
    </CartaCard>
  )
}

/** A one-line textarea that grows with its content. */
function GrowingTextarea({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      maxLength={400}
      aria-label={label}
      placeholder="Escribe la descripción en inglés"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="block min-h-9 w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2.5 py-1.5 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}

type EnglishStatus = "all" | "missing" | "auto" | "reviewed"

const ROW_GRID = "md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_6rem_5.5rem] md:gap-x-3"

/**
 * Idiomas: the English switch is part of the settings form; each dish's
 * English description is written by the restaurant (there is no translation
 * service) and saved with the dish.
 */
export function LanguagesCard({
  englishEnabled,
  onEnglishEnabled,
  ...props
}: DishDraftProps & { englishEnabled: boolean; onEnglishEnabled: (on: boolean) => void }) {
  const { dishes, categories, drafts, dirtyIds, savingId, onChange, onSave } = props
  const statuses: DishStatus<EnglishStatus>[] = [
    { key: "all", label: "Todos", match: () => true },
    { key: "missing", label: "Sin inglés", match: (d) => !(draftOf(d, drafts).descriptionEn ?? "").trim() },
    { key: "auto", label: "Automáticas", match: (d) => !draftOf(d, drafts).descriptionEnReviewed },
    { key: "reviewed", label: "Revisadas", match: (d) => draftOf(d, drafts).descriptionEnReviewed },
  ]
  const filter = useDishFilter(dishes, statuses)
  const bulk = useSaveAll(dishes, dirtyIds, onSave)
  const reviewed = dishes.filter((d) => d.descriptionEnReviewed).length

  return (
    <CartaCard id="carta-idiomas" title="Idiomas" description="Para turistas, sin trabajo extra.">
      <SwitchRow
        title="Inglés según el idioma del celular"
        description="Los comensales con el celular en inglés ven los nombres de las franjas y las descripciones que escribas aquí."
      >
        <Switch aria-label="Inglés según el idioma del celular" checked={englishEnabled} onCheckedChange={onEnglishEnabled} />
      </SwitchRow>
      <DishTableToolbar
        filter={filter}
        statuses={statuses}
        categories={categories}
        dirtyCount={bulk.ids.length}
        saving={bulk.saving || savingId !== null}
        onSaveAll={() => void bulk.saveAll()}
      />
      {dishes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {reviewed} de {dishes.length} platos con inglés revisado
        </p>
      )}
      {filter.visible.length > 0 && (
        <div className="rounded-md border">
          <div className={cn("hidden border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid", ROW_GRID)} aria-hidden>
            <span>Plato</span>
            <span>Descripción en inglés</span>
            <span>Estado</span>
            <span />
          </div>
          <ul className="divide-y">
            {filter.visible.map((dish) => {
              const draft = draftOf(dish, drafts)
              const category = categories?.find((c) => c.id === dish.categoryId)?.name
              return (
                <li key={dish.id}>
                  <div
                    role="group"
                    aria-label={`Inglés de ${dish.name}`}
                    className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 px-3 py-2", ROW_GRID)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{dish.name}</p>
                      {dish.description && <p className="line-clamp-2 text-xs text-muted-foreground">{dish.description}</p>}
                      {category && <p className="text-xs text-muted-foreground/80">{category}</p>}
                    </div>
                    <div className="col-span-2 md:col-span-1 md:col-start-2 md:row-start-1">
                      <GrowingTextarea
                        label={`Descripción en inglés de ${dish.name}`}
                        value={draft.descriptionEn ?? ""}
                        onChange={(value) => onChange(dish.id, { descriptionEn: value, descriptionEnReviewed: true })}
                      />
                    </div>
                    <span className="col-start-2 row-start-1 md:col-start-3 md:pt-1.5">
                      <StaticChip tone={draft.descriptionEnReviewed ? "ok" : "muted"}>
                        {draft.descriptionEnReviewed ? "Revisada" : "Automática"}
                      </StaticChip>
                    </span>
                    <div className="col-span-2 flex justify-end empty:hidden md:col-span-1 md:col-start-4 md:row-start-1">
                      <SaveDish dishId={dish.id} dirtyIds={dirtyIds} savingId={savingId} onSave={onSave} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <DishTableFooter total={dishes.length} filter={filter} />
    </CartaCard>
  )
}
