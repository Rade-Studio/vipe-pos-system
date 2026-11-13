"use client"

import { useState } from "react"
import { dishCount, type CartLine } from "@/lib/carta/cart"
import { formatCop, formatTime } from "@/lib/carta/format"
import { TAG_LABELS, type CartaStrings } from "@/lib/carta/i18n"
import {
  closedSentence,
  daypartName,
  dishDescription,
  dishUnitPrice,
  featuredDish,
  menuSections,
  peekSentence,
  promotionLabel,
} from "@/lib/carta/menu"
import type { Carta, CartaDish, CartaLang } from "@/lib/carta/types"
import { cn } from "@/lib/utils"
import { DishPhoto } from "./DishPhoto"
import { SearchIcon } from "./icons"
import { BRAND_FILL, BRAND_TEXT, BRAND_TINT, FOCUS, GHOST, TAG, TAG_TONES, TONES } from "./styles"

interface MenuProps {
  carta: Carta
  lang: CartaLang
  t: CartaStrings
  viewedDaypartId: string | null
  onViewDaypart: (id: string) => void
  canAdd: boolean
  lines: CartLine[]
  onOpenDish: (dish: CartaDish) => void
  onQuickAdd: (dish: CartaDish) => void
}

/** Banners, dayparts, dish of the day, search, category tabs and dish rows (S5–S8). */
export function CartaMenu({ carta, lang, t, viewedDaypartId, onViewDaypart, canAdd, lines, onOpenDish, onQuickAdd }: MenuProps) {
  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const viewed = carta.dayparts.find((d) => d.id === viewedDaypartId) ?? null
  const peeking = carta.isOpenNow && viewed !== null && viewed.id !== carta.currentDaypartId
  const sections = menuSections(carta, viewedDaypartId, query, t)
  const special = query.trim() ? null : featuredDish(carta, viewedDaypartId)

  return (
    <>
      {!carta.isOpenNow && (
        <div role="status" aria-labelledby="banner-closed" className={cn("mx-[18px] mt-3.5 grid gap-0.5 rounded-card border px-3.5 py-3 text-[13px]", TONES.reserved)}>
          <b id="banner-closed" className="text-[13.5px]">
            {t.closed}
          </b>
          <span>{closedSentence(carta, t)}</span>
        </div>
      )}
      {peeking && viewed && (
        <div role="status" className={cn("mx-[18px] mt-3.5 grid gap-0.5 rounded-card border px-3.5 py-3 text-[13px]", TONES.served)}>
          <b className="text-[13.5px]">{daypartName(viewed, lang)}</b>
          <span>{peekSentence(viewed, lang, t)}</span>
        </div>
      )}

      {carta.dayparts.length > 0 && (
        <div
          role="group"
          aria-label={t.dayparts}
          className="mx-[18px] mt-4 grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-line bg-surface-2 p-1"
        >
          {carta.dayparts.map((d) => {
            const selected = d.id === viewedDaypartId
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onViewDaypart(d.id)}
                className={cn(
                  "min-h-11 min-w-0 rounded-[9px] px-1.5 py-1 text-[13.5px] font-medium leading-tight text-fg-2",
                  selected && cn("bg-surface shadow-sm outline outline-1 outline-line-strong", BRAND_TEXT),
                  FOCUS,
                )}
              >
                {daypartName(d, lang)}
                {d.id === carta.currentDaypartId && (
                  <span className={cn("ml-1 inline-block text-[10.5px] font-bold uppercase tracking-wider", BRAND_TEXT)}>{t.now}</span>
                )}
                <small className="block text-[11.5px] font-normal text-muted-fg">
                  {formatTime(d.startsAt)} – {formatTime(d.endsAt)}
                </small>
              </button>
            )
          })}
        </div>
      )}

      {special && (
        <button
          type="button"
          onClick={() => onOpenDish(special)}
          className={cn(
            "mx-[18px] mt-3.5 grid w-[calc(100%-36px)] grid-cols-[minmax(0,1fr)_92px] gap-3 rounded-card border p-3.5 text-left",
            BRAND_TINT,
            FOCUS,
          )}
        >
          <span className="min-w-0">
            <span className={cn("block text-[11.5px] font-bold uppercase tracking-[0.14em]", BRAND_TEXT)}>{t.special}</span>
            <span className="mt-1 block text-[17px] font-semibold tracking-tight">{special.name}</span>
            {dishDescription(special, lang) && (
              <span className="mt-1 block text-[13px] text-fg-2">{dishDescription(special, lang)}</span>
            )}
            <span className="mt-2 block text-[15px] font-semibold tabular-nums">{formatCop(dishUnitPrice(special))}</span>
          </span>
          <DishPhoto src={special.imageUrl} sizes="92px" className="h-[92px] w-[92px] rounded-[20px]" />
        </button>
      )}

      <div className="sticky top-0 z-10 mt-1.5 border-b border-line bg-canvas pt-3.5">
        <div role="search" className="relative mx-[18px]">
          <SearchIcon className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-fg" />
          <label htmlFor="carta-q" className="sr-only">
            {t.search}
          </label>
          <input
            id="carta-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            autoComplete="off"
            className={cn("h-11 w-full rounded-xl border border-line-strong bg-surface pl-[38px] pr-3 text-[14.5px] text-fg", FOCUS)}
          />
        </div>
        {sections.length > 0 && (
          <nav
            aria-label={t.categories}
            className="flex snap-x snap-mandatory gap-1 overflow-x-auto px-[18px] pt-2 [mask-image:linear-gradient(90deg,#000_85%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {sections.map((s, i) => {
              const current = (activeCategory ?? sections[0].id) === s.id || (!activeCategory && i === 0)
              return (
                <a
                  key={s.id}
                  href={`#cat-${s.id}`}
                  aria-current={current ? "true" : undefined}
                  onClick={() => setActiveCategory(s.id)}
                  className={cn(
                    "inline-flex min-h-11 flex-none snap-start items-center whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-muted-fg",
                    current && "border-[var(--brand)] text-fg",
                    FOCUS,
                  )}
                >
                  {s.name}
                </a>
              )
            })}
          </nav>
        )}
      </div>

      <div className="px-[18px]">
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={`cat-${s.id}`}>
            <h2
              id={`cat-${s.id}`}
              className="scroll-mt-28 pb-1.5 pt-[22px] text-[13px] font-bold uppercase tracking-[0.14em] text-muted-fg"
            >
              {s.name}
            </h2>
            <ul>
              {s.dishes.map((d) => (
                <DishRow
                  key={d.id}
                  dish={d}
                  lang={lang}
                  t={t}
                  canAdd={canAdd}
                  listed={dishCount(lines, d.id) > 0}
                  onOpen={() => onOpenDish(d)}
                  onQuickAdd={() => onQuickAdd(d)}
                />
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && (
          <div role="status" className="grid justify-items-center gap-2.5 px-1 py-8 text-center text-muted-fg">
            <p>{t.noResults(query.trim())}</p>
            <button
              type="button"
              onClick={() => {
                setQuery("")
                document.getElementById("carta-q")?.focus()
              }}
              className={cn(GHOST, "text-fg", FOCUS)}
            >
              {t.clear}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export function DishTags({ dish, lang, t }: { dish: CartaDish; lang: CartaLang; t: CartaStrings }) {
  const promo = promotionLabel(dish, t)
  return (
    <>
      {promo && dish.available && <span className={cn(TAG, TONES.occupied)}>{promo}</span>}
      {!dish.available && <span className={cn(TAG, TONES.reserved)}>{t.soldOut}</span>}
      {dish.tags.map((tag) => (
        <span key={tag} className={cn(TAG, TONES[TAG_TONES[tag]])}>
          {TAG_LABELS[lang][tag]}
        </span>
      ))}
    </>
  )
}

export function DishPrice({ dish, className }: { dish: CartaDish; className?: string }) {
  const unit = dishUnitPrice(dish)
  return (
    <span className={cn("whitespace-nowrap font-semibold tabular-nums", className)}>
      {formatCop(unit)}
      {unit !== dish.price && <s className="ml-1.5 text-[0.85em] font-normal text-muted-fg">{formatCop(dish.price)}</s>}
    </span>
  )
}

function DishRow({
  dish,
  lang,
  t,
  canAdd,
  listed,
  onOpen,
  onQuickAdd,
}: {
  dish: CartaDish
  lang: CartaLang
  t: CartaStrings
  canAdd: boolean
  listed: boolean
  onOpen: () => void
  onQuickAdd: () => void
}) {
  const description = dishDescription(dish, lang)
  const out = !dish.available
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_96px] items-start gap-3.5 border-b border-line py-3.5 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={t.openDish(dish.name, formatCop(dishUnitPrice(dish)), out)}
        className={cn("grid min-w-0 gap-1 rounded-lg text-left", FOCUS)}
      >
        <span className={cn("block text-base font-semibold leading-tight tracking-tight", out && "text-muted-fg")}>{dish.name}</span>
        {description && <span className="line-clamp-2 text-[13.5px] text-muted-fg">{description}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <DishPrice dish={dish} className={cn("mr-1 text-[15px]", out && "text-muted-fg")} />
          <DishTags dish={dish} lang={lang} t={t} />
        </span>
      </button>
      <div className="relative w-24">
        <DishPhoto src={dish.imageUrl} sizes="96px" muted={out} className="h-24 w-24 rounded-[20px]" />
        {canAdd && !out && (
          <button
            type="button"
            onClick={onQuickAdd}
            aria-label={listed ? t.removeList(dish.name) : t.addList(dish.name)}
            aria-pressed={listed}
            className={cn(
              "absolute bottom-0 right-0 grid h-11 w-11 place-items-center rounded-full text-[22px] leading-none shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)]",
              listed ? cn("bg-surface outline outline-2 outline-[var(--brand)]", BRAND_TEXT) : BRAND_FILL,
              FOCUS,
            )}
          >
            <span aria-hidden="true">{listed ? "✓" : "+"}</span>
          </button>
        )}
      </div>
    </li>
  )
}
