import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/errors"
import {
  ALL_PROMOTIONS,
  CATEGORIES,
  CERVEZA,
  CUMPLEANOS,
  DISHES,
  DOMICILIOS,
  HAPPY_HOUR,
  MARTES,
  MENU_EJECUTIVO,
  NAVIDAD,
  NOW,
  OCTUBRE,
  SUBCATEGORIES,
  promotion,
} from "./promotion-fixtures"
import {
  CHANNELS,
  apiFieldErrors,
  billPreview,
  checkDraft,
  competingPromotions,
  draftBody,
  draftFromPromotion,
  draftScheduleSentence,
  draftSentence,
  emptyDraft,
  kindIcon,
  promotionPills,
  statePill,
  tabCounts,
  usageText,
} from "./promotion-model"

/** promociones T5/T6 (S9, S10) — the pure rules behind the admin list and editor. */

const menu = { categories: CATEGORIES, subcategories: SUBCATEGORIES, dishes: DISHES }

describe("list (S9)", () => {
  it("names each state like the 02 list", () => {
    expect(statePill(HAPPY_HOUR, NOW)).toEqual({ label: "Activa · 50 min", tone: "ok" })
    expect(statePill(MENU_EJECUTIVO, NOW)).toEqual({ label: "Hoy 12:00–15:00", tone: "neutral" })
    expect(statePill(DOMICILIOS, NOW)).toEqual({ label: "Activa", tone: "ok" })
    expect(statePill(MARTES, NOW)).toEqual({ label: "Martes", tone: "neutral" })
    expect(statePill(CUMPLEANOS, NOW)).toEqual({ label: "Disponible", tone: "ok" })
    expect(statePill(NAVIDAD, NOW)).toEqual({ label: "Empieza 1 dic", tone: "sched" })
    expect(statePill(CERVEZA, NOW)).toEqual({ label: "Pausada", tone: "paused" })
    expect(statePill(OCTUBRE, NOW)).toEqual({ label: "Terminada", tone: "ended" })
  })

  it("counts the tabs; Todas leaves out the ended ones", () => {
    expect(tabCounts(ALL_PROMOTIONS)).toEqual({ all: 7, active: 2, scheduled: 3, paused: 1, manual: 1, ended: 1 })
  })

  it("marks the kind, and PIN for the manual ones", () => {
    expect(kindIcon(HAPPY_HOUR)).toEqual({ label: "2×1", manual: false })
    expect(kindIcon(MENU_EJECUTIVO)).toEqual({ label: "▣", manual: false })
    expect(kindIcon(DOMICILIOS)).toEqual({ label: "Σ", manual: false })
    expect(kindIcon(MARTES)).toEqual({ label: "%", manual: false })
    expect(kindIcon(CUMPLEANOS)).toEqual({ label: "PIN", manual: true })
  })

  it("lists days, hours, channels and limits as pills", () => {
    expect(promotionPills(HAPPY_HOUR)).toEqual(["Lun–Vie", "17:00–19:00", "Salón"])
    expect(promotionPills(DOMICILIOS)).toEqual(["Todos los días", "Domicilio", "Desde $80.000", "Tope $15.000"])
    expect(promotionPills(MARTES)).toEqual(["Martes", "Todo el día", "Todos los canales"])
    expect(promotionPills(CUMPLEANOS)).toEqual(["1 por cuenta", "Requiere PIN"])
    expect(promotionPills(NAVIDAD)).toEqual(["1–24 dic", "Todos los canales"])
    expect(promotionPills(CERVEZA)).toEqual(["Vie–Sáb", "20:00–23:00", "Salón"])
  })

  it("shows the uses and discount of the last 30 days", () => {
    expect(usageText(HAPPY_HOUR.stats)).toEqual({ main: "148 usos", sub: "−$3.552.000 · 30 días" })
    expect(usageText({ usesLast30Days: 1, discountLast30Days: 9000 })).toEqual({ main: "1 uso", sub: "−$9.000 · 30 días" })
    expect(usageText(NAVIDAD.stats)).toEqual({ main: "—", sub: "Aún sin usos" })
  })
})

describe("Así funcionará (S10)", () => {
  it("builds the server sentence for the four kinds", () => {
    expect(draftSentence(draftFromPromotion(HAPPY_HOUR), menu)).toBe("Lleva 2 cócteles y paga 1; sale gratis el más económico.")
    expect(draftSentence(draftFromPromotion(MARTES), menu)).toBe("20% en la subcategoría Hamburguesas.")
    expect(draftSentence(draftFromPromotion(MENU_EJECUTIVO), menu)).toBe("1 sopa + 1 principio + 1 jugo por $24.000.")
    expect(draftSentence(draftFromPromotion(DOMICILIOS), menu)).toBe("10% en cuentas desde $80.000, con tope de $15.000.")
    expect(draftSentence(draftFromPromotion(CERVEZA), menu)).toBe("Lleva 2 productos; la segunda al 50%.")
    expect(draftSentence({ ...draftFromPromotion(DOMICILIOS), minSubtotal: "" }, menu)).toBe(
      "10% sobre la cuenta, con tope de $15.000 por pedido.",
    )
    expect(
      draftSentence({ ...draftFromPromotion(MARTES), discountType: "fixed_amount", discountValue: "3000" }, menu),
    ).toBe("$3.000 menos por unidad en la subcategoría Hamburguesas.")
    expect(draftSentence({ ...draftFromPromotion(HAPPY_HOUR), buyQuantity: "3", payQuantity: "1" }, menu)).toBe(
      "Lleva 3 cócteles y paga 1; salen gratis los 2 más económicos.",
    )
  })

  it("adds when, where and how it applies", () => {
    expect(draftScheduleSentence(draftFromPromotion(HAPPY_HOUR))).toBe(
      "De lunes a viernes de 17:00 a 19:00, en salón. Se aplica sola al pedir.",
    )
    expect(draftScheduleSentence(draftFromPromotion(DOMICILIOS))).toBe("Todos los días, todo el día, en domicilio. Se aplica sola al pedir.")
    expect(draftScheduleSentence(draftFromPromotion(CUMPLEANOS))).toBe(
      "Todos los días, todo el día, en todos los canales. La aplica la caja con motivo y PIN de administrador.",
    )
  })

  it("previews a bill like the 02 examples", () => {
    expect(billPreview(draftFromPromotion(HAPPY_HOUR), menu)).toEqual([
      { label: "1 × Margarita", amount: "$26.000" },
      { label: "1 × Mojito", amount: "$24.000" },
      { label: "Happy hour 2x1 en cócteles", amount: "−$24.000", discount: true },
    ])
    expect(billPreview(draftFromPromotion(MARTES), menu)).toEqual([
      { label: "1 × Hamburguesa clásica", amount: "$29.000" },
      { label: "Martes de hamburguesa 20%", amount: "−$5.800", discount: true },
    ])
    expect(billPreview(draftFromPromotion(MENU_EJECUTIVO), menu)).toEqual([
      { label: "1 × Sopa del día", amount: "$9.000" },
      { label: "1 × Bandeja ejecutiva", amount: "$17.000" },
      { label: "1 × Jugo de mora", amount: "$7.000" },
      { label: "Menú ejecutivo $24.000", amount: "−$9.000", discount: true },
    ])
    expect(billPreview(draftFromPromotion(DOMICILIOS), menu)).toEqual([
      { label: "Subtotal", amount: "$96.000" },
      { label: "10% en domicilios desde $80.000", amount: "−$9.600", discount: true },
    ])
    expect(billPreview({ ...draftFromPromotion(MARTES), targets: { dishIds: [], categoryIds: [], subcategoryIds: [] } }, menu)).toEqual([])
  })

  it("finds another promotion on the same dish", () => {
    const found = competingPromotions(draftFromPromotion(HAPPY_HOUR), HAPPY_HOUR.id, ALL_PROMOTIONS, DISHES)
    expect(found).toEqual([{ promotion: CERVEZA, dishNames: ["Michelada de la casa"] }])
    expect(competingPromotions(draftFromPromotion(MARTES), MARTES.id, ALL_PROMOTIONS, DISHES)).toEqual([])
  })
})

describe("body (S10, S1)", () => {
  const today = "2026-11-13"

  it("sends a product discount", () => {
    const draft = { ...emptyDraft(today), name: "Martes", discountValue: "20", days: [2], targets: MARTES.targets }
    expect(draftBody(draft)).toEqual({
      name: "Martes",
      kind: "product_discount",
      mode: "automatic",
      active: true,
      discountType: "percentage",
      discountValue: 20,
      buyQuantity: null,
      payQuantity: null,
      restDiscountPercent: null,
      comboPrice: null,
      comboGroups: [],
      minSubtotal: null,
      maxDiscount: null,
      targets: MARTES.targets,
      daysOfWeek: [2],
      timeWindows: [],
      channels: [],
      maxUsesPerOrder: null,
      startDate: today,
      endDate: null,
    })
  })

  it("keeps the stored start when the date did not change and sends a changed end as a day", () => {
    const draft = draftFromPromotion(NAVIDAD)
    expect(draftBody(draft, NAVIDAD)).not.toHaveProperty("startDate")
    expect(draftBody(draft, NAVIDAD)).not.toHaveProperty("endDate")
    expect(draftBody({ ...draft, endDate: "2026-12-31" }, NAVIDAD)).toMatchObject({ endDate: "2026-12-31" })
    expect(draftBody({ ...draft, endDate: "" }, NAVIDAD)).toMatchObject({ endDate: null })
  })

  it("round-trips every kind it reads", () => {
    for (const p of [HAPPY_HOUR, MENU_EJECUTIVO, DOMICILIOS, MARTES, CUMPLEANOS, CERVEZA]) {
      const body = draftBody(draftFromPromotion(p), p)
      expect(body).toMatchObject({
        kind: p.kind,
        mode: p.mode,
        discountValue: p.discountValue,
        buyQuantity: p.buyQuantity,
        payQuantity: p.payQuantity,
        restDiscountPercent: p.restDiscountPercent,
        comboPrice: p.comboPrice,
        comboGroups: p.comboGroups.map(({ name, dishIds }) => ({ name, dishIds })),
        minSubtotal: p.minSubtotal,
        maxDiscount: p.maxDiscount,
        daysOfWeek: p.daysOfWeek,
        timeWindows: p.timeWindows,
        channels: p.channels,
        maxUsesPerOrder: p.maxUsesPerOrder,
        active: p.active,
      })
    }
  })

  it("sends every day and the three channels as empty lists", () => {
    const draft = { ...emptyDraft(today), days: [1, 2, 3, 4, 5, 6, 7], channels: ["delivery", "takeaway", "dine_in"] as const }
    expect(draftBody({ ...draft, channels: [...draft.channels] })).toMatchObject({ daysOfWeek: [], channels: [] })
  })

  it("offers Salón, Para llevar and Domicilio, all chosen on a new promotion (S8)", () => {
    expect(CHANNELS.map((c) => [c.value, c.label])).toEqual([
      ["dine_in", "Salón"],
      ["takeaway", "Para llevar"],
      ["delivery", "Domicilio"],
    ])
    expect(emptyDraft(today).channels).toEqual(["dine_in", "takeaway", "delivery"])
  })

  it("edits a takeaway channel as a toggle and sends it in menu order (S8)", () => {
    const draft = draftFromPromotion(promotion({ channels: ["takeaway"] }))
    expect(draft.channels).toEqual(["takeaway"])
    expect(draft.extraChannels).toEqual([])
    expect(draftBody({ ...draft, channels: ["delivery", "takeaway"] })).toMatchObject({ channels: ["takeaway", "delivery"] })
    expect(draftScheduleSentence({ ...draft, channels: ["takeaway"] })).toContain("en para llevar.")
    expect(draftScheduleSentence({ ...draft, channels: ["dine_in", "takeaway", "delivery"] })).toContain("en todos los canales.")
  })
})

describe("validation (S10)", () => {
  it("explains in Spanish what the API would refuse", () => {
    const draft = {
      ...emptyDraft("2026-11-13"),
      kind: "buy_x_pay_y" as const,
      buyQuantity: "2",
      payQuantity: "2",
      days: [],
      channels: [],
      windows: [{ from: "19:00", to: "17:00" }],
      endDate: "2026-11-01",
    }
    expect(checkDraft(draft)).toEqual({
      name: "Escribe el nombre de la promoción",
      payQuantity: "Paga debe ser al menos 1 y menor que Lleva",
      targets: "Elige al menos un producto, categoría o subcategoría",
      daysOfWeek: "Elige al menos un día",
      "timeWindows.0": "La hora Desde debe ser antes que Hasta",
      channels: "Elige al menos un canal",
      endDate: "La fecha final no puede ser antes de la inicial",
    })
  })

  it("maps a 422 to the fields", () => {
    const error = new ApiError(422, "Unprocessable Entity", "discountValue: discount_percentage_range; comboGroups.1.dishIds: combo_group_empty", {
      code: "discount_percentage_range",
    })
    expect(apiFieldErrors(error)).toEqual({
      discountValue: "El porcentaje debe ser mayor que 0 y hasta 100",
      "comboGroups.1": "Cada grupo necesita un nombre y al menos un plato",
    })
    expect(apiFieldErrors(new ApiError(422, "Unprocessable Entity", "unknown_target", { code: "unknown_target" }))).toEqual({
      form: "Un producto o grupo elegido ya no existe; quítalo y vuelve a guardar",
    })
    expect(apiFieldErrors(new ApiError(500, "Internal Server Error", "boom"))).toBeNull()
  })
})
