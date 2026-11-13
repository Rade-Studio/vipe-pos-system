"use client"

import { useId, useState } from "react"
import type { CartOption } from "@/lib/carta/cart"
import { formatCop } from "@/lib/carta/format"
import type { CartaStrings } from "@/lib/carta/i18n"
import {
  dishDescription,
  dishUnitPrice,
  isSingleChoice,
  minimumFor,
  missingGroup,
  selectionDelta,
  type ModifierSelection,
} from "@/lib/carta/menu"
import type { CartaDish, CartaLang } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { BottomSheet } from "./BottomSheet"
import { DishPrice, DishTags } from "./CartaMenu"
import { DishPhoto } from "./DishPhoto"
import { ShareIcon } from "./icons"
import { BRAND_FILL, CTA, FOCUS, GHOST, TAG, TONES } from "./styles"

export interface DishChoice {
  options: CartOption[]
  note: string | null
  unitPrice: number
}

/**
 * Dish sheet (S8): photo, price, description, tags, modifier groups with
 * their price deltas, the optional kitchen note and the add CTA with the live
 * price. `blockedLabel` replaces the CTA when the dish cannot be added now.
 */
export function DishSheet({
  dish,
  lang,
  t,
  blockedLabel,
  onClose,
  onAdd,
  onShare,
}: {
  dish: CartaDish
  lang: CartaLang
  t: CartaStrings
  blockedLabel: string | null
  onClose: () => void
  onAdd: (choice: DishChoice) => void
  onShare: () => void
}) {
  const [selection, setSelection] = useState<ModifierSelection>({})
  const [note, setNote] = useState("")
  const ids = useId()
  const groups = dish.modifierGroups
  const unitPrice = dishUnitPrice(dish) + selectionDelta(groups, selection)
  const missing = missingGroup(groups, selection)
  const description = dishDescription(dish, lang)
  const canAdd = blockedLabel === null

  const toggle = (groupId: string, optionId: string, single: boolean, max: number | null) =>
    setSelection((current) => {
      const chosen = current[groupId] ?? []
      if (single) return { ...current, [groupId]: [optionId] }
      if (chosen.includes(optionId)) return { ...current, [groupId]: chosen.filter((id) => id !== optionId) }
      if (max !== null && chosen.length >= max) return current
      return { ...current, [groupId]: [...chosen, optionId] }
    })

  const add = () => {
    const options = groups.flatMap((g) =>
      g.options
        .filter((o) => (selection[g.id] ?? []).includes(o.id))
        .map((o) => ({ groupId: g.id, optionId: o.id, name: o.name, price: o.price })),
    )
    onAdd({ options, note: note.trim() || null, unitPrice })
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={dish.name}
      titleHidden
      closeLabel={t.close}
      lang={lang}
      footer={
        <>
          <button type="button" onClick={onShare} aria-label={`${t.share}: ${dish.name}`} className={cn(GHOST, "flex-none px-3.5", FOCUS)}>
            <ShareIcon />
          </button>
          {canAdd ? (
            <button
              type="button"
              onClick={add}
              disabled={missing !== null}
              aria-describedby={missing ? `${ids}-missing` : undefined}
              className={cn(CTA, BRAND_FILL, FOCUS)}
            >
              {t.add(formatCop(unitPrice))}
            </button>
          ) : (
            <button type="button" disabled className={cn(CTA, FOCUS)}>
              {blockedLabel}
            </button>
          )}
        </>
      }
    >
      <DishPhoto src={dish.imageUrl} sizes="480px" muted={!dish.available} className="h-[190px] w-full rounded-[20px]" />
      <div>
        {/* The sheet's title (sr-only) already names it for assistive tech. */}
        <p className="text-[22px] font-semibold tracking-tight" aria-hidden="true">
          {dish.name}
        </p>
        <p className="mt-1">
          <DishPrice dish={dish} className="text-lg" />
        </p>
        {description && <p className="mt-1.5 text-[14.5px] text-muted-fg">{description}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <DishTags dish={dish} lang={lang} t={t} />
      </div>
      {!dish.available && (
        <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-fg-2">{t.soldOutInfo}</p>
      )}
      {canAdd &&
        groups.map((g) => {
          const single = isSingleChoice(g)
          const chosen = selection[g.id] ?? []
          const required = minimumFor(g) > 0
          return (
            <fieldset key={g.id} className="grid gap-1.5">
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {g.name}
                <span className={cn(TAG, required ? TONES.warning : "border-line-strong text-fg-2")}>
                  {required ? t.required : t.optional}
                </span>
                {!single && g.maxSelect !== null && <span className="text-xs font-normal text-muted-fg">{t.upTo(g.maxSelect)}</span>}
              </legend>
              {g.options.map((o) => {
                const checked = chosen.includes(o.id)
                const full = !single && !checked && g.maxSelect !== null && chosen.length >= g.maxSelect
                return (
                  <label
                    key={o.id}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-line-strong px-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-focus",
                      checked && "border-[var(--brand-line)] bg-[var(--brand-tint)]",
                      full && "opacity-50",
                    )}
                  >
                    <input
                      type={single ? "radio" : "checkbox"}
                      name={`${ids}-${g.id}`}
                      checked={checked}
                      disabled={full}
                      onChange={() => toggle(g.id, o.id, single, g.maxSelect)}
                      className="h-5 w-5 flex-none accent-[var(--brand)]"
                    />
                    {o.name}
                    {o.price !== 0 && (
                      <span className="ml-auto text-[13px] tabular-nums text-muted-fg">
                        {o.price > 0 ? "+" : ""}
                        {formatCop(o.price)}
                      </span>
                    )}
                  </label>
                )
              })}
            </fieldset>
          )
        })}
      {canAdd && missing && (
        <p id={`${ids}-missing`} className="text-[13px] text-muted-fg">
          {t.choose(missing.name)}
        </p>
      )}
      {canAdd && dish.allowComments && (
        <div className="grid gap-1.5">
          <label htmlFor={`${ids}-note`} className="text-[13px] font-semibold">
            {t.note}
          </label>
          <input
            id={`${ids}-note`}
            value={note}
            maxLength={140}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            className={cn("min-h-[46px] w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px]", FOCUS)}
          />
        </div>
      )}
    </BottomSheet>
  )
}
