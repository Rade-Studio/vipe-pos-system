"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { CartaAdminDish, CartaDishDetails, DishTag } from "@/lib/api/carta-admin"
import { formatCop } from "@/lib/carta/format"
import { TAG_LABELS } from "@/lib/carta/i18n"
import { CartaCard, StaticChip, SwitchRow, ToggleChip } from "./parts"

const TAGS = Object.keys(TAG_LABELS.es) as DishTag[]

export interface DishDraftProps {
  dishes: CartaAdminDish[]
  drafts: Record<string, CartaDishDetails>
  dirtyIds: ReadonlySet<string>
  savingId: string | null
  onChange: (dishId: string, patch: Partial<CartaDishDetails>) => void
  onSave: (dishId: string) => void
}

function SaveDish({ dishId, dirtyIds, savingId, onSave }: Pick<DishDraftProps, "dirtyIds" | "savingId" | "onSave"> & { dishId: string }) {
  return (
    <Button type="button" size="sm" variant="outline" disabled={!dirtyIds.has(dishId) || savingId !== null} onClick={() => onSave(dishId)}>
      {savingId === dishId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      Guardar
    </Button>
  )
}

/** Platos y etiquetas: tag chips per dish; "Lo más pedido" is computed by the API. */
export function DishesCard({ dishes, drafts, dirtyIds, savingId, onChange, onSave }: DishDraftProps) {
  return (
    <CartaCard id="carta-platos" title="Platos y etiquetas" description="Toca una etiqueta para ponerla o quitarla.">
      {dishes.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay platos en el menú.</p>}
      <ul className="divide-y rounded-md border">
        {dishes.map((dish) => {
          const tags = drafts[dish.id]?.tags ?? dish.tags
          return (
            <li key={dish.id}>
              <div role="group" aria-label={`Etiquetas de ${dish.name}`} className="flex flex-col gap-2 px-3 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{dish.name}</span>
                    <span className="text-muted-foreground">{formatCop(dish.price)}</span>
                    {dish.mostOrdered && <StaticChip tone="ok"><span className="whitespace-nowrap">★ Lo más pedido</span></StaticChip>}
                    {!dish.active && <StaticChip tone="warn">Pausado</StaticChip>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {TAGS.map((tag) => (
                    <ToggleChip
                      key={tag}
                      pressed={tags.includes(tag)}
                      onClick={() => onChange(dish.id, { tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] })}
                    >
                      {TAG_LABELS.es[tag]}
                    </ToggleChip>
                  ))}
                  <SaveDish dishId={dish.id} dirtyIds={dirtyIds} savingId={savingId} onSave={onSave} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        “Lo más pedido” se calcula solo con las ventas de los últimos 30 días. “Agotado” también es automático: sale del inventario o
        de la producción del día, no hay que marcarlo aquí.
      </p>
    </CartaCard>
  )
}

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
  const { dishes, drafts, onChange } = props
  return (
    <CartaCard id="carta-idiomas" title="Idiomas" description="Para turistas, sin trabajo extra.">
      <SwitchRow
        title="Inglés según el idioma del celular"
        description="Los comensales con el celular en inglés ven los nombres de las franjas y las descripciones que escribas aquí."
      >
        <Switch aria-label="Inglés según el idioma del celular" checked={englishEnabled} onCheckedChange={onEnglishEnabled} />
      </SwitchRow>
      <ul className="space-y-3">
        {dishes.map((dish) => {
          const draft = drafts[dish.id] ?? { tags: dish.tags, descriptionEn: dish.descriptionEn, descriptionEnReviewed: dish.descriptionEnReviewed }
          return (
            <li key={dish.id}>
              <div role="group" aria-label={`Inglés de ${dish.name}`} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{dish.name}</p>
                  <StaticChip tone={draft.descriptionEnReviewed ? "ok" : "muted"}>
                    {draft.descriptionEnReviewed ? "Revisada" : "Automática"}
                  </StaticChip>
                </div>
                {dish.description && <p className="text-sm text-muted-foreground">{dish.description}</p>}
                <Textarea
                  rows={2}
                  maxLength={400}
                  aria-label={`Descripción en inglés de ${dish.name}`}
                  placeholder="Escribe la descripción en inglés"
                  value={draft.descriptionEn ?? ""}
                  onChange={(event) => onChange(dish.id, { descriptionEn: event.target.value, descriptionEnReviewed: true })}
                />
                <div className="flex justify-end">
                  <SaveDish dishId={dish.id} {...props} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </CartaCard>
  )
}
