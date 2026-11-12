/**
 * promociones T5/T6 (S9, S10) — the pure rules behind the Promociones page:
 * state pills, tabs and pills of the list from the API's `schedule` and
 * `stats`, and the editor's draft, request body, validation, live sentence and
 * bill preview. The sentence mirrors `apps/api/src/promotions/promotion-text.ts`
 * so "Así funcionará" reads what the server will store.
 */
import { ApiError } from "@/lib/api/errors"
import type {
  CategoryDto,
  CreatePromotionBody,
  DishDto,
  PromotionDto,
  PromotionKind,
  PromotionMode,
  PromotionStatsDto,
  PromotionTargetsDto,
} from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"

type Promotion = PromotionDto

/** Whole pesos with dot thousands, as the server writes them: 80000 → "$80.000". */
export function formatPesos(amount: number): string {
  return `$${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
}

const SHORT_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const LONG_DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1)
const lower = (text: string) => text.toLocaleLowerCase("es")
const listed = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`)
const clockMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
const isoDay = (date: Date) => ((date.getDay() + 6) % 7) + 1

// ---- List (S9) ----------------------------------------------------------------

/** The order types (orders.order_type): salón, para llevar (S8 of promociones-mejoras) and domicilio. */
export const CHANNELS = [
  { value: "dine_in", label: "Salón" },
  { value: "takeaway", label: "Para llevar" },
  { value: "delivery", label: "Domicilio" },
] as const
export type DraftChannel = (typeof CHANNELS)[number]["value"]
const CHANNEL_LABELS: Record<string, string> = { dine_in: "Salón", takeaway: "Para llevar", delivery: "Domicilio" }

export type StateTone = "ok" | "sched" | "paused" | "neutral" | "ended"

export const isManual = (mode: PromotionMode) => mode !== "automatic"

/** The square at the start of a row: %, 2×1, ▣, Σ, or PIN for the ones the cashier applies. */
export function kindIcon(promotion: Promotion): { label: string; manual: boolean } {
  if (isManual(promotion.mode)) return { label: "PIN", manual: true }
  switch (promotion.kind) {
    case "buy_x_pay_y":
      return { label: `${promotion.buyQuantity ?? 2}×${promotion.payQuantity ?? 1}`, manual: false }
    case "combo":
      return { label: "▣", manual: false }
    case "bill_discount":
      return { label: "Σ", manual: false }
    default:
      return { label: "%", manual: false }
  }
}

const shortDate = (iso: string) => {
  const date = new Date(iso)
  return { day: date.getDate(), month: MONTHS[date.getMonth()] }
}

/** The next weekday (after today) the promotion runs on: "Martes". */
function nextDayName(daysOfWeek: number[], now: Date): string {
  const days = daysOfWeek.length ? daysOfWeek : ALL_DAYS
  const today = isoDay(now)
  for (let k = 1; k <= 7; k++) {
    const day = ((today - 1 + k) % 7) + 1
    if (days.includes(day)) return capitalize(LONG_DAYS[day - 1])
  }
  return capitalize(LONG_DAYS[today - 1])
}

/** The state pill, from the server's `schedule` (computed in the restaurant timezone). */
export function statePill(promotion: Promotion, now: Date): { label: string; tone: StateTone } {
  const { schedule } = promotion
  switch (schedule.reason) {
    case "active": {
      if (!schedule.endsAt) return { label: "Activa", tone: "ok" }
      const left = clockMinutes(schedule.endsAt) - (now.getHours() * 60 + now.getMinutes())
      return { label: left > 0 ? `Activa · ${left} min` : "Activa", tone: "ok" }
    }
    case "outside_hours": {
      const window = promotion.timeWindows.find((w) => w.from === schedule.nextStartToday)
      if (window) return { label: `Hoy ${window.from}–${window.to}`, tone: "neutral" }
      return { label: nextDayName(promotion.daysOfWeek, now), tone: "neutral" }
    }
    case "other_day":
      return { label: nextDayName(promotion.daysOfWeek, now), tone: "neutral" }
    case "not_started": {
      const { day, month } = shortDate(promotion.startDate)
      return { label: `Empieza ${day} ${month}`, tone: "sched" }
    }
    case "paused":
      return { label: "Pausada", tone: "paused" }
    case "manual":
      return { label: "Disponible", tone: "ok" }
    default:
      return { label: "Terminada", tone: "ended" }
  }
}

export type PromotionTab = "all" | "active" | "scheduled" | "paused" | "manual" | "ended"

export const PROMOTION_TABS: readonly { id: PromotionTab; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "active", label: "Aplicando ahora" },
  { id: "scheduled", label: "Programadas" },
  { id: "paused", label: "Pausadas" },
  { id: "manual", label: "Manuales" },
  { id: "ended", label: "Terminadas" },
]

/** The tab a promotion belongs to besides "Todas", which holds every one that has not ended (02). */
export function promotionTab(promotion: Promotion): Exclude<PromotionTab, "all"> {
  switch (promotion.schedule.reason) {
    case "active":
      return "active"
    case "paused":
      return "paused"
    case "manual":
      return "manual"
    case "ended":
      return "ended"
    default:
      return "scheduled"
  }
}

export function inTab(promotion: Promotion, tab: PromotionTab): boolean {
  const own = promotionTab(promotion)
  return tab === "all" ? own !== "ended" : own === tab
}

export function tabCounts(promotions: readonly Promotion[]): Record<PromotionTab, number> {
  const counts = { all: 0, active: 0, scheduled: 0, paused: 0, manual: 0, ended: 0 }
  for (const tab of PROMOTION_TABS) counts[tab.id] = promotions.filter((p) => inTab(p, tab.id)).length
  return counts
}

/** "Lun–Vie", "Martes", "Lun, Mié", "Todos los días". */
function daysPill(daysOfWeek: number[]): string {
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b)
  if (days.length === 0 || days.length === 7) return "Todos los días"
  if (days.length === 1) return capitalize(LONG_DAYS[days[0] - 1])
  if (days[days.length - 1] - days[0] === days.length - 1) return `${SHORT_DAYS[days[0] - 1]}–${SHORT_DAYS[days[days.length - 1] - 1]}`
  return days.map((d) => SHORT_DAYS[d - 1]).join(", ")
}

/** "1–24 dic", "15 nov–6 ene". */
function datesPill(startIso: string, endIso: string): string {
  const start = shortDate(startIso)
  const end = shortDate(endIso)
  return start.month === end.month ? `${start.day}–${end.day} ${end.month}` : `${start.day} ${start.month}–${end.day} ${end.month}`
}

/**
 * Days, hours, channels and limits. A manual promotion shows only its limits
 * (the cashier picks it); a dated one shows its dates instead of "Todos los días".
 */
export function promotionPills(promotion: Promotion): string[] {
  const pills: string[] = []
  const everyDay = promotion.daysOfWeek.length === 0 || promotion.daysOfWeek.length === 7
  if (!isManual(promotion.mode)) {
    if (promotion.endDate) pills.push(datesPill(promotion.startDate, promotion.endDate))
    if (!promotion.endDate || !everyDay) pills.push(daysPill(promotion.daysOfWeek))
    if (promotion.timeWindows.length) pills.push(...promotion.timeWindows.map((w) => `${w.from}–${w.to}`))
    else if (!everyDay) pills.push("Todo el día")
    pills.push(
      promotion.channels.length === 0 ? "Todos los canales" : promotion.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(" · "),
    )
  }
  if (promotion.maxUsesPerOrder !== null) pills.push(`${promotion.maxUsesPerOrder} por cuenta`)
  if (promotion.kind === "bill_discount" && promotion.minSubtotal) pills.push(`Desde ${formatPesos(promotion.minSubtotal)}`)
  if (promotion.kind === "bill_discount" && promotion.maxDiscount !== null) pills.push(`Tope ${formatPesos(promotion.maxDiscount)}`)
  if (promotion.mode === "manual_pin") pills.push("Requiere PIN")
  return pills
}

/** "148 usos" over "−$3.552.000 · 30 días", or "—" over "Aún sin usos". */
export function usageText(stats: PromotionStatsDto): { main: string; sub: string } {
  if (stats.usesLast30Days === 0) return { main: "—", sub: "Aún sin usos" }
  return {
    main: `${stats.usesLast30Days} ${stats.usesLast30Days === 1 ? "uso" : "usos"}`,
    sub: `−${formatPesos(stats.discountLast30Days)} · 30 días`,
  }
}

// ---- Editor draft (S10) ---------------------------------------------------------

export interface ComboGroupDraft {
  name: string
  dishIds: string[]
}

/** The editor's state: numbers as typed, dates as YYYY-MM-DD, "" for an empty optional field. */
export interface PromotionDraft {
  name: string
  kind: PromotionKind
  mode: PromotionMode
  active: boolean
  discountType: "percentage" | "fixed_amount"
  discountValue: string
  buyQuantity: string
  payQuantity: string
  /** "Las demás": 100 = Gratis, 50 = Al 50%. */
  restDiscountPercent: number
  comboPrice: string
  comboGroups: ComboGroupDraft[]
  minSubtotal: string
  maxDiscount: string
  targets: PromotionTargetsDto
  /** Selected ISO days; all seven = every day. */
  days: number[]
  /** Rows of Desde/Hasta; a single empty row = all day. */
  windows: { from: string; to: string }[]
  startDate: string
  endDate: string
  channels: DraftChannel[]
  /** Stored channels the editor does not offer (none today), kept on save. */
  extraChannels: PromotionDto["channels"]
  /** "" = Sin límite. */
  maxUses: string
}

const noTargets = (): PromotionTargetsDto => ({ dishIds: [], categoryIds: [], subcategoryIds: [] })

/** Local YYYY-MM-DD of a date-time. */
export function localDay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function emptyDraft(today: string): PromotionDraft {
  return {
    name: "",
    kind: "product_discount",
    mode: "automatic",
    active: true,
    discountType: "percentage",
    discountValue: "",
    buyQuantity: "2",
    payQuantity: "1",
    restDiscountPercent: 100,
    comboPrice: "",
    comboGroups: [{ name: "", dishIds: [] }],
    minSubtotal: "",
    maxDiscount: "",
    targets: noTargets(),
    days: [...ALL_DAYS],
    windows: [{ from: "", to: "" }],
    startDate: today,
    endDate: "",
    channels: CHANNELS.map((c) => c.value),
    extraChannels: [],
    maxUses: "",
  }
}

const text = (value: number | null) => (value === null ? "" : String(value))
const isDraftChannel = (value: string): value is DraftChannel => CHANNELS.some((c) => c.value === value)

export function draftFromPromotion(promotion: Promotion): PromotionDraft {
  const base = emptyDraft(localDay(promotion.startDate))
  return {
    ...base,
    name: promotion.name,
    kind: promotion.kind,
    mode: promotion.mode,
    active: promotion.active,
    discountType: promotion.discountType ?? "percentage",
    discountValue: text(promotion.discountValue),
    buyQuantity: promotion.buyQuantity === null ? base.buyQuantity : String(promotion.buyQuantity),
    payQuantity: promotion.payQuantity === null ? base.payQuantity : String(promotion.payQuantity),
    restDiscountPercent: promotion.restDiscountPercent ?? 100,
    comboPrice: text(promotion.comboPrice),
    comboGroups: promotion.comboGroups.length
      ? promotion.comboGroups.map((g) => ({ name: g.name, dishIds: [...g.dishIds] }))
      : base.comboGroups,
    minSubtotal: text(promotion.minSubtotal),
    maxDiscount: text(promotion.maxDiscount),
    targets: {
      dishIds: [...promotion.targets.dishIds],
      categoryIds: [...promotion.targets.categoryIds],
      subcategoryIds: [...promotion.targets.subcategoryIds],
    },
    days: promotion.daysOfWeek.length ? [...promotion.daysOfWeek].sort((a, b) => a - b) : [...ALL_DAYS],
    windows: promotion.timeWindows.length ? promotion.timeWindows.map((w) => ({ ...w })) : base.windows,
    endDate: promotion.endDate ? localDay(promotion.endDate) : "",
    channels: promotion.channels.length ? promotion.channels.filter(isDraftChannel) : base.channels,
    extraChannels: promotion.channels.filter((c) => !isDraftChannel(c)),
    maxUses: text(promotion.maxUsesPerOrder),
  }
}

/** A typed number, or null for an empty or unreadable field. */
export function parseNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".")
  if (trimmed === "") return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const filledWindows = (draft: PromotionDraft) => draft.windows.filter((w) => w.from !== "" || w.to !== "")
const usesTargets = (kind: PromotionKind) => kind === "product_discount" || kind === "buy_x_pay_y"

/**
 * The POST/PATCH body. Fields of the other kinds go as null (the server stores
 * them so); every day and every channel go as empty lists ("todos"). On an
 * edit the dates are sent only when changed: a YYYY-MM-DD resets the stored
 * time to the start (or end) of that day.
 */
export function draftBody(draft: PromotionDraft, original?: Promotion | null): CreatePromotionBody {
  const kind = draft.kind
  const discount = kind === "product_discount" || kind === "bill_discount"
  const allDays = ALL_DAYS.every((d) => draft.days.includes(d))
  const allChannels = CHANNELS.every((c) => draft.channels.includes(c.value)) && draft.extraChannels.length === 0
  const body: CreatePromotionBody = {
    name: draft.name.trim(),
    kind,
    mode: draft.mode,
    active: draft.active,
    discountType: discount ? draft.discountType : null,
    discountValue: discount ? parseNumber(draft.discountValue) : null,
    buyQuantity: kind === "buy_x_pay_y" ? parseNumber(draft.buyQuantity) : null,
    payQuantity: kind === "buy_x_pay_y" ? parseNumber(draft.payQuantity) : null,
    restDiscountPercent: kind === "buy_x_pay_y" ? draft.restDiscountPercent : null,
    comboPrice: kind === "combo" ? parseNumber(draft.comboPrice) : null,
    comboGroups: kind === "combo" ? draft.comboGroups.map((g) => ({ name: g.name.trim(), dishIds: [...g.dishIds] })) : [],
    minSubtotal: kind === "bill_discount" ? parseNumber(draft.minSubtotal) : null,
    maxDiscount: kind === "bill_discount" ? parseNumber(draft.maxDiscount) : null,
    targets: usesTargets(kind) ? draft.targets : noTargets(),
    daysOfWeek: allDays ? [] : [...draft.days].sort((a, b) => a - b),
    timeWindows: filledWindows(draft).map((w) => ({ from: w.from, to: w.to })),
    channels: allChannels ? [] : [...CHANNELS.map((c) => c.value).filter((c) => draft.channels.includes(c)), ...draft.extraChannels],
    maxUsesPerOrder: parseNumber(draft.maxUses),
  }
  const stored = original ? draftFromPromotion(original) : null
  if (!stored || stored.startDate !== draft.startDate) body.startDate = draft.startDate
  if (!stored || stored.endDate !== draft.endDate) body.endDate = draft.endDate === "" ? null : draft.endDate
  return body
}

// ---- Validation (S10): the API's 422 codes in Spanish --------------------------

export const PROMOTION_ERROR_MESSAGES: Record<string, string> = {
  promotion_invalid: "Revisa este dato",
  discount_required: "Escribe el valor del descuento",
  discount_percentage_range: "El porcentaje debe ser mayor que 0 y hasta 100",
  buy_quantity_invalid: "Lleva debe ser un número entero de 2 a 99",
  pay_quantity_invalid: "Paga debe ser al menos 1 y menor que Lleva",
  rest_discount_invalid: "El descuento de las demás va de 1% a 100%",
  combo_price_invalid: "El precio del combo debe ser mayor que 0",
  combo_groups_count: "Un combo tiene de 1 a 6 grupos",
  combo_group_empty: "Cada grupo necesita un nombre y al menos un plato",
  min_subtotal_invalid: "La cuenta mínima debe ser 0 o más",
  max_discount_invalid: "El tope debe ser mayor que 0",
  time_window_invalid: "La hora Desde debe ser antes que Hasta",
  days_of_week_invalid: "Revisa los días elegidos",
  channels_invalid: "Revisa los canales elegidos",
  max_uses_invalid: "El máximo por cuenta va de 1 a 999",
  end_before_start: "La fecha final no puede ser antes de la inicial",
  unknown_target: "Un producto o grupo elegido ya no existe; quítalo y vuelve a guardar",
}

/** Field key → message; `form` holds what belongs to no field. */
export type FieldErrors = Record<string, string>

const FIELD_KEYS = new Set([
  "name",
  "discountValue",
  "buyQuantity",
  "payQuantity",
  "restDiscountPercent",
  "comboPrice",
  "comboGroups",
  "minSubtotal",
  "maxDiscount",
  "targets",
  "daysOfWeek",
  "timeWindows",
  "channels",
  "maxUsesPerOrder",
  "startDate",
  "endDate",
])

const fieldKey = (path: string): string => {
  const [head, index] = path.split(".")
  if (!FIELD_KEYS.has(head)) return "form"
  return (head === "comboGroups" || head === "timeWindows") && index !== undefined && /^\d+$/.test(index) ? `${head}.${index}` : head
}

/** A 422 of the promotions API as messages next to the fields; null for any other error. */
export function apiFieldErrors(error: unknown): FieldErrors | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const errors: FieldErrors = {}
  for (const part of error.message.split("; ")) {
    const match = /^([\w.]+): (\w+)$/.exec(part.trim())
    const key = match ? fieldKey(match[1]) : "form"
    const code = match ? match[2] : part.trim()
    errors[key] ??= PROMOTION_ERROR_MESSAGES[code] ?? (typeof error.body.code === "string" ? PROMOTION_ERROR_MESSAGES[error.body.code] : undefined) ?? part
  }
  return errors
}

const isWhole = (value: number | null): value is number => value !== null && Number.isInteger(value)

/** What the API would refuse, checked before sending; empty when the draft can be saved. */
export function checkDraft(draft: PromotionDraft): FieldErrors {
  const errors: FieldErrors = {}
  const m = PROMOTION_ERROR_MESSAGES
  if (!draft.name.trim()) errors.name = "Escribe el nombre de la promoción"
  if (draft.kind === "product_discount" || draft.kind === "bill_discount") {
    const value = parseNumber(draft.discountValue)
    if (value === null) errors.discountValue = m.discount_required
    else if (draft.discountType === "percentage" && (value <= 0 || value > 100)) errors.discountValue = m.discount_percentage_range
    else if (value <= 0) errors.discountValue = "El valor debe ser mayor que 0"
  }
  if (usesTargets(draft.kind)) {
    const t = draft.targets
    if (t.dishIds.length + t.categoryIds.length + t.subcategoryIds.length === 0)
      errors.targets = "Elige al menos un producto, categoría o subcategoría"
  }
  if (draft.kind === "buy_x_pay_y") {
    const n = parseNumber(draft.buyQuantity)
    const pay = parseNumber(draft.payQuantity)
    if (!isWhole(n) || n < 2 || n > 99) errors.buyQuantity = m.buy_quantity_invalid
    if (!isWhole(pay) || pay < 1 || (isWhole(n) && pay >= n)) errors.payQuantity = m.pay_quantity_invalid
  }
  if (draft.kind === "combo") {
    const price = parseNumber(draft.comboPrice)
    if (price === null || price <= 0) errors.comboPrice = m.combo_price_invalid
    if (draft.comboGroups.length < 1 || draft.comboGroups.length > 6) errors.comboGroups = m.combo_groups_count
    draft.comboGroups.forEach((group, index) => {
      if (!group.name.trim() || group.dishIds.length === 0) errors[`comboGroups.${index}`] = m.combo_group_empty
    })
  }
  if (draft.kind === "bill_discount") {
    const min = parseNumber(draft.minSubtotal)
    const cap = parseNumber(draft.maxDiscount)
    if (draft.minSubtotal.trim() !== "" && (min === null || min < 0)) errors.minSubtotal = m.min_subtotal_invalid
    if (draft.maxDiscount.trim() !== "" && (cap === null || cap <= 0)) errors.maxDiscount = m.max_discount_invalid
  }
  if (draft.days.length === 0) errors.daysOfWeek = "Elige al menos un día"
  draft.windows.forEach((window, index) => {
    if (window.from === "" && window.to === "") return
    if (window.from === "" || window.to === "") errors[`timeWindows.${index}`] = "Completa Desde y Hasta"
    else if (window.from >= window.to) errors[`timeWindows.${index}`] = m.time_window_invalid
  })
  if (draft.channels.length === 0 && draft.extraChannels.length === 0) errors.channels = "Elige al menos un canal"
  if (draft.maxUses.trim() !== "") {
    const uses = parseNumber(draft.maxUses)
    if (!isWhole(uses) || uses < 1 || uses > 999) errors.maxUsesPerOrder = m.max_uses_invalid
  }
  if (!draft.startDate) errors.startDate = "Elige desde qué día rige"
  else if (draft.endDate && draft.endDate < draft.startDate) errors.endDate = m.end_before_start
  return errors
}

// ---- Así funcionará (S10) -------------------------------------------------------

export interface MenuData {
  categories: readonly CategoryDto[]
  subcategories: readonly SubcategoryDto[]
  dishes: readonly DishDto[]
}

const nameOf = (list: readonly { id: string; name: string }[], id: string) => list.find((item) => item.id === id)?.name

const targetCount = (t: PromotionTargetsDto) => t.dishIds.length + t.categoryIds.length + t.subcategoryIds.length

/** promotion-text.ts `targetPhrase`. */
function targetPhrase(t: PromotionTargetsDto, menu: MenuData): string | null {
  const count = targetCount(t)
  if (count === 0) return null
  if (t.categoryIds.length === 1 && count === 1) return `la categoría ${nameOf(menu.categories, t.categoryIds[0]) ?? "elegida"}`
  if (t.subcategoryIds.length === 1 && count === 1) return `la subcategoría ${nameOf(menu.subcategories, t.subcategoryIds[0]) ?? "elegida"}`
  if (count === t.dishIds.length && count <= 3) return listed(t.dishIds.map((id) => nameOf(menu.dishes, id) ?? "producto"))
  return `${count} productos o grupos`
}

/** promotion-text.ts `unitsNoun`. */
function unitsNoun(t: PromotionTargetsDto, menu: MenuData): string {
  const count = targetCount(t)
  if (count === 1 && t.categoryIds.length === 1) return lower(nameOf(menu.categories, t.categoryIds[0]) ?? "productos")
  if (count === 1 && t.subcategoryIds.length === 1) return lower(nameOf(menu.subcategories, t.subcategoryIds[0]) ?? "productos")
  return "productos"
}

/** The rule as the server will write it in `sentence` ("Lleva 2 cócteles y paga 1; sale gratis el más económico."). */
export function draftSentence(draft: PromotionDraft, menu: MenuData): string {
  const value = parseNumber(draft.discountValue) ?? 0
  const amount = draft.discountType === "percentage" ? `${value}%` : formatPesos(value)
  switch (draft.kind) {
    case "buy_x_pay_y": {
      const n = parseNumber(draft.buyQuantity) ?? 0
      const pay = parseNumber(draft.payQuantity) ?? 0
      const free = n - pay
      const rest = draft.restDiscountPercent
      const noun = unitsNoun(draft.targets, menu)
      if (rest === 100) {
        const tail = free === 1 ? "sale gratis el más económico" : `salen gratis los ${free} más económicos`
        return `Lleva ${n} ${noun} y paga ${pay}; ${tail}.`
      }
      if (n === 2 && free === 1 && rest === 50) return `Lleva 2 ${noun}; la segunda al 50%.`
      const who = free === 1 ? "la más económica" : `las ${free} más económicas`
      return `Lleva ${n} ${noun}; ${who} con ${rest}% de descuento.`
    }
    case "combo": {
      const groups = draft.comboGroups
        .filter((g) => g.name.trim())
        .map((g) => `1 ${lower(g.name.trim())}`)
        .join(" + ")
      return `${groups || "Combo"} por ${formatPesos(parseNumber(draft.comboPrice) ?? 0)}.`
    }
    case "bill_discount": {
      const max = parseNumber(draft.maxDiscount)
      const min = parseNumber(draft.minSubtotal)
      const cap = max !== null ? formatPesos(max) : null
      const benefit = draft.discountType === "percentage" ? amount : `${amount} menos`
      if (min !== null && min > 0) {
        const base = `${benefit} en cuentas desde ${formatPesos(min)}`
        return cap ? `${base}, con tope de ${cap}.` : `${base}.`
      }
      return cap ? `${benefit} sobre la cuenta, con tope de ${cap} por pedido.` : `${benefit} sobre la cuenta.`
    }
    default: {
      const where = targetPhrase(draft.targets, menu)
      if (draft.discountType === "percentage") return where ? `${amount} en ${where}.` : `${amount} de descuento.`
      return where ? `${amount} menos por unidad en ${where}.` : `${amount} menos por unidad.`
    }
  }
}

const plural = (day: string) => (day.endsWith("s") ? day : `${day}s`)

function daysPhrase(days: number[]): string {
  const idx = [...new Set(days)].sort((a, b) => a - b)
  if (idx.length === 7) return "Todos los días"
  if (idx.length === 0) return "Ningún día (no se aplicará)"
  if (idx.length > 2 && idx[idx.length - 1] - idx[0] === idx.length - 1)
    return `De ${LONG_DAYS[idx[0] - 1]} a ${LONG_DAYS[idx[idx.length - 1] - 1]}`
  return `Los ${listed(idx.map((d) => plural(LONG_DAYS[d - 1])))}`
}

const MODE_SENTENCE: Record<PromotionMode, string> = {
  automatic: "Se aplica sola al pedir.",
  manual: "La aplica la caja cuando la elige.",
  manual_pin: "La aplica la caja con motivo y PIN de administrador.",
}

/** When, where and how: "De lunes a viernes de 17:00 a 19:00, en salón. Se aplica sola al pedir." */
export function draftScheduleSentence(draft: PromotionDraft): string {
  const windows = filledWindows(draft).filter((w) => w.from && w.to)
  const hours = windows.length ? ` ${windows.map((w) => `de ${w.from} a ${w.to}`).join(" y ")}` : ", todo el día"
  const channels = CHANNELS.filter((c) => draft.channels.includes(c.value)).map((c) => lower(c.label))
  const where =
    channels.length === CHANNELS.length
      ? "en todos los canales"
      : channels.length === 0 && draft.extraChannels.length === 0
        ? "en ningún canal (no se aplicará)"
        : `en ${listed([...channels, ...draft.extraChannels.map((c) => lower(CHANNEL_LABELS[c] ?? c))])}`
  return `${daysPhrase(draft.days)}${hours}, ${where}. ${MODE_SENTENCE[draft.mode]}`
}

export interface PreviewLine {
  label: string
  amount: string
  discount?: true
}

const matches = (dish: DishDto, t: PromotionTargetsDto) =>
  t.dishIds.includes(dish.id) ||
  (dish.categoryId !== null && t.categoryIds.includes(dish.categoryId)) ||
  (dish.subcategoryId !== null && t.subcategoryIds.includes(dish.subcategoryId))

/** "1 × Margarita $26.000" lines for the given units, grouped by dish in order. */
function unitLines(units: readonly DishDto[]): PreviewLine[] {
  const lines: { dish: DishDto; qty: number }[] = []
  for (const unit of units) {
    const line = lines.find((l) => l.dish.id === unit.id)
    if (line) line.qty += 1
    else lines.push({ dish: unit, qty: 1 })
  }
  return lines.map((l) => ({ label: `${l.qty} × ${l.dish.name}`, amount: formatPesos(l.dish.price * l.qty) }))
}

/** A small example bill with the draft's discount, from real dishes of the menu; empty when there is nothing to show. */
export function billPreview(draft: PromotionDraft, menu: MenuData): PreviewLine[] {
  const label = draft.name.trim() || "Promoción sin nombre"
  const discountLine = (amount: number): PreviewLine => ({ label, amount: `−${formatPesos(amount)}`, discount: true })
  const value = parseNumber(draft.discountValue)
  switch (draft.kind) {
    case "buy_x_pay_y": {
      const n = parseNumber(draft.buyQuantity)
      const pay = parseNumber(draft.payQuantity)
      const eligible = menu.dishes.filter((d) => matches(d, draft.targets)).sort((a, b) => b.price - a.price)
      if (!eligible.length || !isWhole(n) || !isWhole(pay) || n < 2 || pay < 1 || pay >= n) return []
      const units = Array.from({ length: n }, (_, i) => eligible[Math.min(i, eligible.length - 1)])
      const off = units.slice(pay).reduce((sum, d) => sum + Math.round((d.price * draft.restDiscountPercent) / 100), 0)
      return [...unitLines(units), discountLine(off)]
    }
    case "combo": {
      const picks = draft.comboGroups
        .map((g) => menu.dishes.find((d) => d.id === g.dishIds[0]))
        .filter((d): d is DishDto => d !== undefined)
      const price = parseNumber(draft.comboPrice)
      if (!picks.length || price === null || price <= 0) return []
      const off = picks.reduce((sum, d) => sum + d.price, 0) - price
      return off > 0 ? [...unitLines(picks), discountLine(off)] : unitLines(picks)
    }
    case "bill_discount": {
      if (value === null || value <= 0) return []
      const min = parseNumber(draft.minSubtotal)
      const cap = parseNumber(draft.maxDiscount)
      const base = min && min > 0 ? Math.round(min * 1.2) : 100000
      let off = draft.discountType === "percentage" ? Math.round((base * Math.min(value, 100)) / 100) : Math.min(value, base)
      if (cap !== null && cap > 0) off = Math.min(off, cap)
      return [{ label: "Subtotal", amount: formatPesos(base) }, discountLine(off)]
    }
    default: {
      const dish = menu.dishes.find((d) => matches(d, draft.targets))
      if (!dish || value === null || value <= 0) return []
      const off = draft.discountType === "percentage" ? Math.round((dish.price * Math.min(value, 100)) / 100) : Math.min(value, dish.price)
      return [...unitLines([dish]), discountLine(off)]
    }
  }
}

/**
 * Other automatic product promotions (not ended) that reach a dish this draft
 * reaches: when both apply, the one that saves the customer more wins (S3).
 */
export function competingPromotions(
  draft: PromotionDraft,
  editingId: string | null,
  promotions: readonly Promotion[],
  dishes: readonly DishDto[],
): { promotion: Promotion; dishNames: string[] }[] {
  if (!usesTargets(draft.kind) || draft.mode !== "automatic") return []
  const mine = dishes.filter((d) => matches(d, draft.targets))
  if (!mine.length) return []
  return promotions
    .filter((p) => p.id !== editingId && usesTargets(p.kind) && p.mode === "automatic" && p.schedule.reason !== "ended")
    .map((promotion) => ({ promotion, dishNames: mine.filter((d) => matches(d, promotion.targets)).map((d) => d.name) }))
    .filter((found) => found.dishNames.length > 0)
}
