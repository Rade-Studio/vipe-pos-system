import { formatTime } from "./format"
import type { CartaStrings } from "./i18n"
import type { Carta, CartaCategory, CartaDaypart, CartaDish, CartaLang, CartaModifierGroup } from "./types"

/**
 * What the guest carta shows, derived from one API response (S4–S8). Pure:
 * the components only render these answers.
 */

export interface MenuSection {
  id: string
  name: string
  dishes: CartaDish[]
}

/** The daypart the carta opens on: the server's current one, else the first. */
export function defaultDaypartId(carta: Carta): string | null {
  return carta.currentDaypartId ?? carta.dayparts[0]?.id ?? null
}

export function daypartName(daypart: CartaDaypart, lang: CartaLang): string {
  return lang === "en" && daypart.nameEn ? daypart.nameEn : daypart.name
}

/**
 * Whether "+" may show: the restaurant is open now (A1: a current daypart is
 * still reported on a closed day) and the guest is looking at the daypart
 * that is being served (or the carta has no dayparts).
 */
export function canAddNow(carta: Carta, viewedDaypartId: string | null): boolean {
  if (!carta.isOpenNow) return false
  if (carta.dayparts.length === 0) return true
  return viewedDaypartId !== null && viewedDaypartId === carta.currentDaypartId
}

export function statusChip(carta: Carta, t: CartaStrings): { open: boolean; label: string } {
  if (!carta.isOpenNow) return { open: false, label: t.closed }
  return { open: true, label: carta.closesAt ? t.open(formatTime(carta.closesAt)) : t.openAlways }
}

export function closedSentence(carta: Carta, t: CartaStrings): string {
  const next = carta.nextOpening
  return t.closedSentence(next ? { ...next, opensAt: formatTime(next.opensAt) } : null)
}

export function peekSentence(daypart: CartaDaypart, lang: CartaLang, t: CartaStrings): string {
  return t.peek(daypartName(daypart, lang), formatTime(daypart.startsAt), formatTime(daypart.endsAt))
}

export function dishDescription(dish: CartaDish, lang: CartaLang): string | null {
  return lang === "en" && dish.descriptionEn ? dish.descriptionEn : dish.description
}

/** The unit price a line gets now: the promotion's price when it has one. */
export function dishUnitPrice(dish: CartaDish): number {
  return dish.promoPrice ?? dish.price
}

export function promotionLabel(dish: CartaDish, t: CartaStrings): string | null {
  if (!dish.promotionBadge) return null
  return dish.promotionEndsAt ? `${dish.promotionBadge} ${t.until(formatTime(dish.promotionEndsAt))}` : dish.promotionBadge
}

export function allDishes(carta: Carta): CartaDish[] {
  return [...carta.menu.categories.flatMap((c) => c.dishes), ...carta.menu.uncategorized]
}

export function findDish(carta: Carta, id: string): CartaDish | undefined {
  return allDishes(carta).find((d) => d.id === id)
}

function matches(dish: CartaDish, q: string): boolean {
  if (!q) return true
  const text = `${dish.name} ${dish.description ?? ""} ${dish.descriptionEn ?? ""}`
  return normalize(text).includes(q)
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-CO")
}

/**
 * The sections of the viewed daypart (its categories, in its order) filtered
 * by the search. Dishes keep the API order: sold-out ones already come last
 * in their category. Uncategorized dishes show only on a carta without
 * dayparts, where no daypart claims categories.
 */
export function menuSections(carta: Carta, daypartId: string | null, query: string, t: CartaStrings): MenuSection[] {
  const daypart = carta.dayparts.find((d) => d.id === daypartId)
  const byId = new Map<string, CartaCategory>(carta.menu.categories.map((c) => [c.id, c]))
  const categories = daypart
    ? daypart.categoryIds.map((id) => byId.get(id)).filter((c): c is CartaCategory => Boolean(c))
    : carta.menu.categories
  const sections: MenuSection[] = categories.map((c) => ({ id: c.id, name: c.name, dishes: c.dishes }))
  if (!daypart && carta.menu.uncategorized.length > 0) {
    sections.push({ id: "uncategorized", name: t.other, dishes: carta.menu.uncategorized })
  }
  const q = normalize(query.trim())
  return sections
    .map((s) => ({ ...s, dishes: s.dishes.filter((d) => matches(d, q)) }))
    .filter((s) => s.dishes.length > 0)
}

export function featuredDish(carta: Carta, daypartId: string | null): CartaDish | null {
  const daypart = carta.dayparts.find((d) => d.id === daypartId)
  if (!daypart?.featuredDishId) return null
  return findDish(carta, daypart.featuredDishId) ?? null
}

/* ---------------------------------------------------------------- modifiers */

/** Selected option ids per group id. */
export type ModifierSelection = Record<string, string[]>

export function isSingleChoice(group: CartaModifierGroup): boolean {
  return group.maxSelect === 1
}

export function minimumFor(group: CartaModifierGroup): number {
  return group.required ? Math.max(1, group.minSelect) : group.minSelect
}

/** The first group whose selection is still short of its minimum, or null. */
export function missingGroup(groups: CartaModifierGroup[], selection: ModifierSelection): CartaModifierGroup | null {
  return groups.find((g) => (selection[g.id]?.length ?? 0) < minimumFor(g)) ?? null
}

export function selectionDelta(groups: CartaModifierGroup[], selection: ModifierSelection): number {
  return groups.reduce((sum, g) => {
    const chosen = selection[g.id] ?? []
    return sum + g.options.filter((o) => chosen.includes(o.id)).reduce((s, o) => s + o.price, 0)
  }, 0)
}

export function hasRequiredModifiers(dish: CartaDish): boolean {
  return dish.modifierGroups.some((g) => minimumFor(g) > 0)
}
