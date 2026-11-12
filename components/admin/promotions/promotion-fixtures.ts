import type { CategoryDto, DishDto, PromotionDto } from "@/lib/api/catalog"
import type { SubcategoryDto } from "@/lib/api/subcategories"

/** Test data shared by the promotion suites: the 02 artboard examples. */

export const category = (id: string, name: string): CategoryDto => ({
  id,
  name,
  description: null,
  icon: "Soup",
  active: true,
  sortOrder: 0,
  color: "neutral",
  hasSubcategories: false,
  createdAt: null,
  updatedAt: null,
})

export const subcategory = (id: string, categoryId: string, name: string): SubcategoryDto => ({
  id,
  categoryId,
  name,
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
})

export const dish = (id: string, name: string, price: number, categoryId: string, subcategoryId: string | null = null): DishDto => ({
  id,
  name,
  description: null,
  price,
  categoryId,
  subcategoryId,
  imageUrl: null,
  active: true,
  allowComments: false,
  sortOrder: 0,
  modifierGroups: [],
  createdAt: null,
  updatedAt: null,
})

export const CATEGORIES = [
  category("c-cocteles", "Cócteles"),
  category("c-fuertes", "Platos fuertes"),
  category("c-sopas", "Sopas"),
  category("c-bebidas", "Bebidas"),
  category("c-postres", "Postres"),
]
export const SUBCATEGORIES = [subcategory("s-hamburguesas", "c-fuertes", "Hamburguesas")]
export const DISHES = [
  dish("d-margarita", "Margarita", 26000, "c-cocteles"),
  dish("d-mojito", "Mojito", 24000, "c-cocteles"),
  dish("d-michelada", "Michelada de la casa", 15000, "c-cocteles"),
  dish("d-hamburguesa", "Hamburguesa clásica", 29000, "c-fuertes", "s-hamburguesas"),
  dish("d-bandeja", "Bandeja ejecutiva", 17000, "c-fuertes"),
  dish("d-sopa", "Sopa del día", 9000, "c-sopas"),
  dish("d-jugo", "Jugo de mora", 7000, "c-bebidas"),
]

const noTargets = { dishIds: [], categoryIds: [], subcategoryIds: [] }

export const promotion = (overrides: Partial<PromotionDto> = {}): PromotionDto => ({
  id: "p-1",
  name: "Promoción",
  description: null,
  kind: "product_discount",
  mode: "automatic",
  discountType: "percentage",
  discountValue: 20,
  buyQuantity: null,
  payQuantity: null,
  restDiscountPercent: null,
  comboPrice: null,
  comboGroups: [],
  minSubtotal: null,
  maxDiscount: null,
  startDate: new Date(2026, 9, 1).toISOString(),
  endDate: null,
  daysOfWeek: [],
  timeWindows: [],
  channels: [],
  maxUsesPerOrder: null,
  active: true,
  targets: noTargets,
  stats: { usesLast30Days: 0, discountLast30Days: 0 },
  schedule: { activeNow: false, reason: "other_day", endsAt: null, nextStartToday: null },
  sentence: "",
  badge: "20%",
  createdAt: null,
  updatedAt: null,
  ...overrides,
})

/** The seven rows of the 02 list, with "now" = Thursday 13 Nov 2026 18:10. */
export const HAPPY_HOUR = promotion({
  id: "p-happy",
  name: "Happy hour 2x1 en cócteles",
  kind: "buy_x_pay_y",
  discountType: null,
  discountValue: null,
  buyQuantity: 2,
  payQuantity: 1,
  restDiscountPercent: 100,
  daysOfWeek: [1, 2, 3, 4, 5],
  timeWindows: [{ from: "17:00", to: "19:00" }],
  channels: ["dine_in"],
  targets: { dishIds: [], categoryIds: ["c-cocteles"], subcategoryIds: [] },
  stats: { usesLast30Days: 148, discountLast30Days: 3552000 },
  schedule: { activeNow: true, reason: "active", endsAt: "19:00", nextStartToday: null },
  sentence: "Lleva 2 cócteles y paga 1; sale gratis el más económico.",
  badge: "2x1",
})

export const MENU_EJECUTIVO = promotion({
  id: "p-menu",
  name: "Menú ejecutivo $24.000",
  kind: "combo",
  discountType: null,
  discountValue: null,
  comboPrice: 24000,
  comboGroups: [
    { id: "g-1", name: "Sopa", dishIds: ["d-sopa"] },
    { id: "g-2", name: "Principio", dishIds: ["d-bandeja"] },
    { id: "g-3", name: "Jugo", dishIds: ["d-jugo"] },
  ],
  daysOfWeek: [1, 2, 3, 4, 5],
  timeWindows: [{ from: "12:00", to: "15:00" }],
  channels: ["dine_in"],
  stats: { usesLast30Days: 612, discountLast30Days: 5508000 },
  schedule: { activeNow: false, reason: "outside_hours", endsAt: null, nextStartToday: "12:00" },
  sentence: "1 sopa + 1 principio + 1 jugo por $24.000.",
  badge: "Combo",
})

export const DOMICILIOS = promotion({
  id: "p-domicilios",
  name: "10% en domicilios desde $80.000",
  kind: "bill_discount",
  discountValue: 10,
  minSubtotal: 80000,
  maxDiscount: 15000,
  channels: ["delivery"],
  stats: { usesLast30Days: 87, discountLast30Days: 812300 },
  schedule: { activeNow: true, reason: "active", endsAt: null, nextStartToday: null },
  sentence: "10% en cuentas desde $80.000, con tope de $15.000.",
  badge: "10%",
})

export const MARTES = promotion({
  id: "p-martes",
  name: "Martes de hamburguesa 20%",
  daysOfWeek: [2],
  targets: { dishIds: [], categoryIds: [], subcategoryIds: ["s-hamburguesas"] },
  stats: { usesLast30Days: 96, discountLast30Days: 556800 },
  schedule: { activeNow: false, reason: "other_day", endsAt: null, nextStartToday: null },
  sentence: "20% en la subcategoría Hamburguesas.",
})

export const CUMPLEANOS = promotion({
  id: "p-cumple",
  name: "Cortesía de cumpleaños",
  mode: "manual_pin",
  discountValue: 100,
  maxUsesPerOrder: 1,
  targets: { dishIds: [], categoryIds: ["c-postres"], subcategoryIds: [] },
  stats: { usesLast30Days: 21, discountLast30Days: 294000 },
  schedule: { activeNow: false, reason: "manual", endsAt: null, nextStartToday: null },
  sentence: "100% en la categoría Postres.",
})

export const NAVIDAD = promotion({
  id: "p-navidad",
  name: "Navidad: 15% en postres",
  discountValue: 15,
  startDate: new Date(2026, 11, 1).toISOString(),
  endDate: new Date(2026, 11, 24, 23, 59, 59).toISOString(),
  targets: { dishIds: [], categoryIds: ["c-postres"], subcategoryIds: [] },
  schedule: { activeNow: false, reason: "not_started", endsAt: null, nextStartToday: null },
  sentence: "15% en la categoría Postres.",
})

export const CERVEZA = promotion({
  id: "p-cerveza",
  name: "Segunda cerveza al 50%",
  kind: "buy_x_pay_y",
  discountType: null,
  discountValue: null,
  buyQuantity: 2,
  payQuantity: 1,
  restDiscountPercent: 50,
  active: false,
  daysOfWeek: [5, 6],
  timeWindows: [{ from: "20:00", to: "23:00" }],
  channels: ["dine_in"],
  targets: { dishIds: ["d-michelada"], categoryIds: [], subcategoryIds: [] },
  stats: { usesLast30Days: 54, discountLast30Days: 243000 },
  schedule: { activeNow: false, reason: "paused", endsAt: null, nextStartToday: null },
  sentence: "Lleva 2 productos; la segunda al 50%.",
})

export const OCTUBRE = promotion({
  id: "p-octubre",
  name: "Octubre 10%",
  discountValue: 10,
  endDate: new Date(2026, 9, 31, 23, 59, 59).toISOString(),
  schedule: { activeNow: false, reason: "ended", endsAt: null, nextStartToday: null },
  sentence: "10% de descuento.",
})

export const ALL_PROMOTIONS = [HAPPY_HOUR, MENU_EJECUTIVO, DOMICILIOS, MARTES, CUMPLEANOS, NAVIDAD, CERVEZA, OCTUBRE]

/** Thursday 13 November 2026, 18:10 local time. */
export const NOW = new Date(2026, 10, 13, 18, 10)
