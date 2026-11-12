import type { MenuTreeCategoryDto, MenuTreeDishDto } from "@/lib/api/catalog"
import type {
  PricingHintDto,
  PricingPreviewDto,
  PricingPreviewRequest,
  PromotionDto,
  PromotionsTodayDto,
  TodayActivePromotionDto,
  TodayOtherPromotionDto,
} from "@/lib/api/promotions"
import { dishIdFromCartItemId } from "@/lib/menu/cart-dish-id"
import { formatCurrency } from "@/utils/helpers"
import type { CartItem } from "@/types"

/**
 * What the waiter sees of the promotions while taking an order (S11, S12;
 * design/promociones/04-mesero.html): the strip, the tags on the tiles, the
 * "Promociones de hoy" sheet, the combo tiles and the discount lines of the
 * pricing preview. Pure: the screen feeds it the `today` answer, the menu tree,
 * the cart and the preview.
 */

/** A promotion ending in this many minutes or less turns the strip and tags yellow. */
export const ENDING_MINUTES = 10

const PRODUCT_KINDS: readonly PromotionDto["kind"][] = ["product_discount", "buy_x_pay_y"]
const isProduct = (promotion: PromotionDto) => PRODUCT_KINDS.includes(promotion.kind)
const isEnding = (minutesLeft: number | null | undefined) => minutesLeft != null && minutesLeft <= ENDING_MINUTES

// ---- Targets ------------------------------------------------------------------

type DishRef = Pick<MenuTreeDishDto, "id" | "categoryId" | "subcategoryId">

/** S1: a dish matches if it is listed or is in a listed category/subcategory. */
export function promotionMatchesDish(promotion: PromotionDto, dish: DishRef): boolean {
  if (!isProduct(promotion)) return false
  const { dishIds, categoryIds, subcategoryIds } = promotion.targets
  return (
    dishIds.includes(dish.id) ||
    (dish.categoryId != null && categoryIds.includes(dish.categoryId)) ||
    (dish.subcategoryId != null && subcategoryIds.includes(dish.subcategoryId))
  )
}

// ---- Tags -----------------------------------------------------------------------

export type PromoTagTone = "on" | "ending" | "later"
export interface PromoTag {
  promotionId: string
  /** "2x1 · hasta 19:00", "2x1 desde 17:00". */
  text: string
  tone: PromoTagTone
}

function tagWhere(today: PromotionsTodayDto | undefined, matches: (promotion: PromotionDto) => boolean): PromoTag | null {
  if (!today) return null
  const now = today.active.find((entry) => isProduct(entry.promotion) && matches(entry.promotion))
  if (now) {
    return {
      promotionId: now.promotion.id,
      text: now.endsAt ? `${now.badge} · hasta ${now.endsAt}` : now.badge,
      tone: isEnding(now.minutesLeft) ? "ending" : "on",
    }
  }
  const later = today.laterToday.find((entry) => isProduct(entry.promotion) && matches(entry.promotion))
  return later ? { promotionId: later.promotion.id, text: `${later.badge} desde ${later.startsAt}`, tone: "later" } : null
}

export const dishTag = (today: PromotionsTodayDto | undefined, dish: DishRef) =>
  tagWhere(today, (promotion) => promotionMatchesDish(promotion, dish))

export const categoryTag = (today: PromotionsTodayDto | undefined, category: MenuTreeCategoryDto) =>
  tagWhere(
    today,
    (promotion) =>
      promotion.targets.categoryIds.includes(category.id) || category.dishes.some((dish) => promotionMatchesDish(promotion, dish)),
  )

/** A subcategory tile; `null` is the "Sin subcategoría" choice. */
export const subcategoryTag = (today: PromotionsTodayDto | undefined, category: MenuTreeCategoryDto, subcategoryId: string | null) =>
  tagWhere(
    today,
    (promotion) =>
      (subcategoryId !== null && promotion.targets.subcategoryIds.includes(subcategoryId)) ||
      promotion.targets.categoryIds.includes(category.id) ||
      category.dishes.some((dish) => (dish.subcategoryId ?? null) === subcategoryId && promotionMatchesDish(promotion, dish)),
  )

// ---- Strip ------------------------------------------------------------------------

export type StripState =
  | { kind: "none"; title: string; text: string | null }
  | { kind: "active" | "ending"; title: string; text: string; left: string | null; badge: string }

/** The strip over the steps: the promotion applying now, or "Sin promociones en este momento". */
export function stripState(today: PromotionsTodayDto | undefined): StripState {
  const now = today?.active[0]
  if (!now) {
    const next = today?.laterToday[0]
    return {
      kind: "none",
      title: "Sin promociones en este momento",
      text: next ? `Próxima: ${next.promotion.name} a las ${next.startsAt}.` : null,
    }
  }
  const ending = isEnding(now.minutesLeft) && now.endsAt != null
  return {
    kind: ending ? "ending" : "active",
    title: now.promotion.name,
    text: ending ? `Termina a las ${now.endsAt}. Envía el pedido antes para que se aplique.` : now.sentence,
    left: leftLabel(now),
    badge: now.badge,
  }
}

function leftLabel(entry: TodayActivePromotionDto): string | null {
  if (!entry.endsAt) return "todo el día"
  if (entry.minutesLeft != null && entry.minutesLeft < 60) return `quedan ${entry.minutesLeft} min`
  return `hasta ${entry.endsAt}`
}

// ---- Schedules ----------------------------------------------------------------------

const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
const DAY_PLURALS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"]
const DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const CHANNEL_LABELS: Record<string, string> = { dine_in: "Salón", delivery: "Domicilio" }

const sortedDays = (days: readonly number[]) => [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b)
const isRun = (days: readonly number[]) => days.every((day, index) => index === 0 || day === days[index - 1] + 1)
const listEs = (parts: readonly string[]) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`)

/** "de lunes a viernes", "los martes", "los lunes, miércoles y viernes", "todos los días". */
export function daysText(daysOfWeek: readonly number[]): string {
  const days = sortedDays(daysOfWeek)
  if (days.length === 0 || days.length === 7) return "todos los días"
  if (days.length >= 3 && isRun(days)) return `de ${DAY_NAMES[days[0] - 1]} a ${DAY_NAMES[days[days.length - 1] - 1]}`
  return `los ${listEs(days.map((day) => DAY_PLURALS[day - 1]))}`
}

/** "de 12:00 a 15:00", "todo el día". */
export function hoursText(windows: readonly { from: string; to: string }[]): string {
  if (windows.length === 0) return "todo el día"
  return listEs(windows.map((window) => `de ${window.from} a ${window.to}`))
}

/** S12 toast: "El Menú ejecutivo se vende de lunes a viernes de 12:00 a 15:00". */
export const sellsText = (promotion: PromotionDto) =>
  `El ${promotion.name} se vende ${daysText(promotion.daysOfWeek)} ${hoursText(promotion.timeWindows)}`

/** "Lun–Vie · 12:00–15:00", plus the channels when given ("· Salón"). */
export function scheduleShort(promotion: PromotionDto, { channels = false }: { channels?: boolean } = {}): string {
  const days = sortedDays(promotion.daysOfWeek)
  const dayPart =
    days.length === 0 || days.length === 7
      ? "Todos los días"
      : days.length >= 3 && isRun(days)
        ? `${DAY_SHORT[days[0] - 1]}–${DAY_SHORT[days[days.length - 1] - 1]}`
        : days.map((day) => DAY_SHORT[day - 1]).join(", ")
  const hourPart = promotion.timeWindows.length === 0 ? "Todo el día" : promotion.timeWindows.map((w) => `${w.from}–${w.to}`).join(", ")
  const channelPart = channels
    ? listEs(promotion.channels.map((channel) => CHANNEL_LABELS[channel]).filter((label): label is string => Boolean(label)))
    : ""
  return [dayPart, hourPart, channelPart].filter(Boolean).join(" · ")
}

// ---- Sheet ------------------------------------------------------------------------------

export interface SheetCard {
  id: string
  name: string
  /** "Al cliente:" sentence. */
  sentence: string
  schedule: string
  tag: { text: string; tone: PromoTagTone }
}

const OTHER_TAGS: Record<TodayOtherPromotionDto["reason"], (entry: TodayOtherPromotionDto) => string> = {
  other_day: (entry) => scheduleShort(entry.promotion).split(" · ")[0],
  outside_hours: (entry) => (entry.promotion.timeWindows.length ? `Terminó ${entry.promotion.timeWindows[entry.promotion.timeWindows.length - 1].to}` : "Fuera de horario"),
  other_channel: (entry) => listEs(entry.promotion.channels.map((channel) => CHANNEL_LABELS[channel]).filter(Boolean)) || "Otro canal",
  manual: () => "La caja la aplica",
  not_started: () => "Programada",
}

/** "Promociones de hoy": Ahora, Más tarde hoy, No aplican ahora en el salón. */
export function sheetGroups(today: PromotionsTodayDto | undefined) {
  const card = (entry: { promotion: PromotionDto; sentence: string }, tag: SheetCard["tag"]): SheetCard => ({
    id: entry.promotion.id,
    name: entry.promotion.name,
    sentence: entry.sentence,
    schedule: scheduleShort(entry.promotion, { channels: true }),
    tag,
  })
  return {
    now: (today?.active ?? []).map((entry) =>
      card(entry, { text: entry.endsAt ? `Hasta ${entry.endsAt}` : "Todo el día", tone: isEnding(entry.minutesLeft) ? "ending" : "on" }),
    ),
    later: (today?.laterToday ?? []).map((entry) => card(entry, { text: `Desde ${entry.startsAt}`, tone: "later" })),
    others: (today?.others ?? []).map((entry) => card(entry, { text: OTHER_TAGS[entry.reason](entry), tone: "later" })),
  }
}

// ---- Combos -----------------------------------------------------------------------------

export interface ComboTile {
  promotion: PromotionDto
  /** Live now on the channel: the builder opens. */
  enabled: boolean
  endsAt: string | null
  minutesLeft: number | null
  startsAt: string | null
}

const COMBO_OFF_REASONS: readonly TodayOtherPromotionDto["reason"][] = ["other_day", "outside_hours", "not_started"]

/** S12: one tile per combo of the channel; only a live one opens the builder. */
export function comboTiles(today: PromotionsTodayDto | undefined): ComboTile[] {
  if (!today) return []
  const isCombo = (promotion: PromotionDto) => promotion.kind === "combo" && promotion.comboGroups.length > 0
  return [
    ...today.active
      .filter((entry) => isCombo(entry.promotion))
      .map((entry) => ({ promotion: entry.promotion, enabled: true, endsAt: entry.endsAt, minutesLeft: entry.minutesLeft, startsAt: null })),
    ...today.laterToday
      .filter((entry) => isCombo(entry.promotion))
      .map((entry) => ({ promotion: entry.promotion, enabled: false, endsAt: null, minutesLeft: null, startsAt: entry.startsAt })),
    ...today.others
      .filter((entry) => isCombo(entry.promotion) && COMBO_OFF_REASONS.includes(entry.reason))
      .map((entry) => ({ promotion: entry.promotion, enabled: false, endsAt: null, minutesLeft: null, startsAt: null })),
  ]
}

/** A combo picked in the builder, as it lives in the cart until it is sent. */
export interface CartCombo {
  promotionId: string
  comboPrice: number
  /** Σ list prices of the choices ("Por separado"). */
  listPrice: number
  choices: { groupId: string; dishId: string; name: string; price: number }[]
}
export type ComboCartItem = CartItem & { combo: CartCombo }

export const isComboLine = (item: CartItem): item is ComboCartItem => "combo" in item && (item as ComboCartItem).combo != null

/** "Por separado $33.000 · ahorra $9.000"; no saving when the sum is not above the price. */
export function comboSavingText(listPrice: number, comboPrice: number): { separate: string; saving: string | null } {
  return {
    separate: `Por separado ${formatCurrency(listPrice)}`,
    saving: listPrice > comboPrice ? `ahorra ${formatCurrency(listPrice - comboPrice)}` : null,
  }
}

// ---- Pricing preview ---------------------------------------------------------------------

export interface PreviewDraft {
  lines: PricingPreviewRequest["lines"]
  /** The cart line behind each draft index. */
  lineIds: string[]
}

/** The cart as preview draft lines, in cart order; a line without a dish is left out. */
export function previewDraft(cart: readonly CartItem[]): PreviewDraft {
  const lines: PricingPreviewRequest["lines"] = []
  const lineIds: string[] = []
  for (const item of cart) {
    if (isComboLine(item)) {
      for (let unit = 0; unit < item.quantity; unit += 1) {
        lines.push({
          comboPromotionId: item.combo.promotionId,
          choices: item.combo.choices.map(({ groupId, dishId }) => ({ groupId, dishId })),
        })
        lineIds.push(item.id)
      }
      continue
    }
    const dishId = dishIdFromCartItemId(item.id)
    if (!dishId) continue
    lines.push({
      dishId,
      quantity: item.quantity,
      ...(item.modifiers?.length ? { modifiers: item.modifiers.map(({ optionId }) => ({ optionId })) } : {}),
    })
    lineIds.push(item.id)
  }
  return { lines, lineIds }
}

export interface DiscountRow {
  label: string
  amount: number
  /** "fijado 18:12" on a sent line. */
  fixedAt?: string | null
}

function addRow(rows: DiscountRow[], label: string, amount: number) {
  const same = rows.find((row) => row.label === label)
  if (same) same.amount += amount
  else rows.push({ label, amount })
}

/** The discounts of each new cart line from the preview (a combo's components add up on its line). */
export function draftDiscounts(preview: PricingPreviewDto | undefined, lineIds: readonly string[]): Map<string, DiscountRow[]> {
  const byLine = new Map<string, DiscountRow[]>()
  for (const line of preview?.lines ?? []) {
    if (line.sent || line.draftIndex == null) continue
    const lineId = lineIds[line.draftIndex]
    if (!lineId) continue
    const rows = byLine.get(lineId) ?? []
    for (const discount of line.discounts) addRow(rows, discount.label, discount.amount)
    if (rows.length) byLine.set(lineId, rows)
  }
  return byLine
}

/** The discounts of each sent line from the preview, by order item id. */
export function sentPreviewDiscounts(preview: PricingPreviewDto | undefined): Map<string, DiscountRow[]> {
  const byItem = new Map<string, DiscountRow[]>()
  for (const line of preview?.lines ?? []) {
    if (!line.sent || !line.orderItemId || line.discounts.length === 0) continue
    byItem.set(
      line.orderItemId,
      line.discounts.map((discount) => ({ label: discount.label, amount: discount.amount })),
    )
  }
  return byItem
}

// ---- Nudges --------------------------------------------------------------------------------

export interface QuickAdd {
  dish: MenuTreeDishDto
  category: MenuTreeCategoryDto
}

/** "Falta 1 … para otro 2x1." with up to `limit` dishes of the promotion to add in one tap: the ones on the order first. */
export function quickAdds(
  hint: PricingHintDto,
  today: PromotionsTodayDto | undefined,
  menu: readonly MenuTreeCategoryDto[] | undefined,
  cart: readonly CartItem[],
  limit = 3,
): QuickAdd[] {
  const promotion = today?.active.find((entry) => entry.promotion.id === hint.promotionId)?.promotion
  if (!promotion || !menu) return []
  const inCart = new Set(cart.map((item) => dishIdFromCartItemId(item.id)))
  const eligible = menu.flatMap((category) =>
    category.dishes
      .filter((dish) => dish.available && dish.modifierGroups.length === 0 && promotionMatchesDish(promotion, dish))
      .map((dish) => ({ dish, category })),
  )
  const seen = new Set<string>()
  return [...eligible.filter((entry) => inCart.has(entry.dish.id)), ...eligible.filter((entry) => !inCart.has(entry.dish.id))]
    .filter((entry) => (seen.has(entry.dish.id) ? false : (seen.add(entry.dish.id), true)))
    .slice(0, limit)
}

export interface WindowWarning {
  promotionId: string
  endsAt: string
  minutesLeft: number
}

/** "Envía antes de las 19:00.": a window ending in ≤ 10 min while unsent lines would get it. */
export function windowWarning(
  today: PromotionsTodayDto | undefined,
  menu: readonly MenuTreeCategoryDto[] | undefined,
  cart: readonly CartItem[],
): WindowWarning | null {
  if (!today || !menu || cart.length === 0) return null
  const dishes = new Map(menu.flatMap((category) => category.dishes).map((dish) => [dish.id, dish]))
  const cartDishes = cart.flatMap((item) => {
    const dish = isComboLine(item) ? undefined : dishes.get(dishIdFromCartItemId(item.id) ?? "")
    return dish ? [dish] : []
  })
  for (const entry of today.active) {
    if (!entry.endsAt || !isEnding(entry.minutesLeft)) continue
    const combo = entry.promotion.kind === "combo" && cart.some((item) => isComboLine(item) && item.combo.promotionId === entry.promotion.id)
    if (combo || cartDishes.some((dish) => promotionMatchesDish(entry.promotion, dish))) {
      return { promotionId: entry.promotion.id, endsAt: entry.endsAt, minutesLeft: entry.minutesLeft ?? 0 }
    }
  }
  return null
}
