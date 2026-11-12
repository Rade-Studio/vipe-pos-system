import type { PromotionDto, PromotionsTodayDto } from "@/lib/api/promotions"

/** Promotion builders for the waiter suites (S11, S12), after design/promociones/04-mesero.html. */
export function promotion(overrides: Partial<PromotionDto> = {}): PromotionDto {
  return {
    id: "p-0",
    name: "Promoción",
    description: null,
    kind: "buy_x_pay_y",
    mode: "automatic",
    discountType: null,
    discountValue: null,
    buyQuantity: 2,
    payQuantity: 1,
    restDiscountPercent: 100,
    comboPrice: null,
    comboGroups: [],
    minSubtotal: null,
    maxDiscount: null,
    startDate: "2026-11-01T05:00:00.000Z",
    endDate: null,
    daysOfWeek: [],
    timeWindows: [],
    channels: [],
    maxUsesPerOrder: null,
    active: true,
    targets: { dishIds: [], categoryIds: [], subcategoryIds: [] },
    stats: { usesLast30Days: 0, discountLast30Days: 0 },
    schedule: { activeNow: false, reason: "active", endsAt: null, nextStartToday: null } as PromotionDto["schedule"],
    sentence: "Lleva 2 y paga 1.",
    badge: "2x1",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

export const COCTELES = "sub-cocteles"

/** "Happy hour 2x1 en cócteles", Lun–Vie 17:00–19:00 in the salón. */
export const happyHour = promotion({
  id: "p-hh",
  name: "Happy hour 2x1 en cócteles",
  daysOfWeek: [1, 2, 3, 4, 5],
  timeWindows: [{ from: "17:00", to: "19:00" }],
  channels: ["dine_in"],
  targets: { dishIds: [], categoryIds: [], subcategoryIds: [COCTELES] },
  sentence: "En cócteles, de 5 a 7, pide 2 y paga 1; se pueden mezclar.",
})

/** "Menú ejecutivo": sopa, principio y bebida por $24.000, Lun–Vie 12:00–15:00. */
export const menuEjecutivo = promotion({
  id: "p-ejec",
  name: "Menú ejecutivo",
  kind: "combo",
  buyQuantity: null,
  payQuantity: null,
  restDiscountPercent: null,
  comboPrice: 24000,
  comboGroups: [
    { id: "g-sopa", name: "Sopa", dishIds: ["d-ajiaco"] },
    { id: "g-principio", name: "Principio", dishIds: ["d-bandeja", "d-pollo"] },
    { id: "g-bebida", name: "Bebida", dishIds: ["d-mora"] },
  ],
  daysOfWeek: [1, 2, 3, 4, 5],
  timeWindows: [{ from: "12:00", to: "15:00" }],
  channels: ["dine_in"],
  sentence: "Sopa, principio y jugo por $24.000.",
  badge: "Combo",
})

export function today(overrides: Partial<PromotionsTodayDto> = {}): PromotionsTodayDto {
  return { now: "2026-11-12T23:10:00.000Z", localTime: "18:10", channel: "dine_in", active: [], laterToday: [], others: [], ...overrides }
}

export const active = (promo: PromotionDto, endsAt: string | null, minutesLeft: number | null) => ({
  promotion: promo,
  sentence: promo.sentence,
  badge: promo.badge,
  endsAt,
  minutesLeft,
})

export const later = (promo: PromotionDto, startsAt: string, minutesUntilStart = 60) => ({
  promotion: promo,
  sentence: promo.sentence,
  badge: promo.badge,
  startsAt,
  minutesUntilStart,
})

export const other = (promo: PromotionDto, reason: PromotionsTodayDto["others"][number]["reason"]) => ({
  promotion: promo,
  sentence: promo.sentence,
  badge: promo.badge,
  reason,
})
