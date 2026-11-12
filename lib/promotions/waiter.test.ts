import { describe, expect, it } from "vitest"

import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import type { PricingPreviewDto } from "@/lib/api/promotions"
import type { CartItem } from "@/types"
import { active, COCTELES, happyHour, later, menuEjecutivo, other, promotion, today } from "./fixtures"
import {
  categoryTag,
  comboSavingText,
  comboTiles,
  daysText,
  dishTag,
  draftDiscounts,
  hoursText,
  previewDraft,
  quickAdds,
  scheduleShort,
  sellsText,
  sentPreviewDiscounts,
  sheetGroups,
  stripState,
  subcategoryTag,
  windowWarning,
  type ComboCartItem,
} from "./waiter"

/** S11/S12 wording of design/promociones/04-mesero.html, from the `today` answer. */

const MOJITO = "11111111-1111-4111-8111-111111111111"
const MARGARITA = "22222222-2222-4222-8222-222222222222"
const CLUB = "33333333-3333-4333-8333-333333333333"
const HAMB = "44444444-4444-4444-8444-444444444444"

const bebidas = menuCategory({
  id: "cat-bebidas",
  name: "Bebidas",
  subcategories: [
    { id: COCTELES, name: "Cócteles" },
    { id: "sub-cervezas", name: "Cervezas" },
  ],
  dishes: [
    menuDish({ id: MOJITO, name: "Mojito", price: 24000, subcategoryId: COCTELES }),
    menuDish({ id: MARGARITA, name: "Margarita", price: 26000, subcategoryId: COCTELES }),
    menuDish({ id: CLUB, name: "Club Colombia", price: 9000, subcategoryId: "sub-cervezas" }),
  ],
})
const fuertes = menuCategory({ id: "cat-fuertes", name: "Fuertes", dishes: [menuDish({ id: HAMB, name: "Hamburguesa", price: 29000 })] })
const menu = [bebidas, fuertes]

const cartLine = (id: string, name: string, price: number, quantity = 1): CartItem => ({
  id: `${id}-x${quantity}`,
  name,
  price,
  quantity,
  categoryId: "",
  image: "",
})

describe("strip (S11)", () => {
  it("shows the active promotion with its customer sentence and minutes left", () => {
    expect(stripState(today({ active: [active(happyHour, "19:00", 50)] }))).toEqual({
      kind: "active",
      title: "Happy hour 2x1 en cócteles",
      text: "En cócteles, de 5 a 7, pide 2 y paga 1; se pueden mezclar.",
      left: "quedan 50 min",
      badge: "2x1",
    })
  })

  it("says hasta HH:MM when an hour or more is left", () => {
    expect(stripState(today({ active: [active(happyHour, "19:00", 110)] }))).toMatchObject({ kind: "active", left: "hasta 19:00" })
  })

  it("turns yellow in the last 10 minutes and asks to send before the end", () => {
    expect(stripState(today({ active: [active(happyHour, "19:00", 10)] }))).toEqual({
      kind: "ending",
      title: "Happy hour 2x1 en cócteles",
      text: "Termina a las 19:00. Envía el pedido antes para que se aplique.",
      left: "quedan 10 min",
      badge: "2x1",
    })
    expect(stripState(today({ active: [active(happyHour, "19:00", 11)] })).kind).toBe("active")
  })

  it("says Sin promociones en este momento without one, with the next one of today", () => {
    expect(stripState(today())).toEqual({ kind: "none", title: "Sin promociones en este momento", text: null })
    expect(stripState(today({ laterToday: [later(happyHour, "17:00")] }))).toEqual({
      kind: "none",
      title: "Sin promociones en este momento",
      text: "Próxima: Happy hour 2x1 en cócteles a las 17:00.",
    })
  })
})

describe("tile tags (S11)", () => {
  const now = today({ active: [active(happyHour, "19:00", 50)] })
  const ending = today({ active: [active(happyHour, "19:00", 8)] })
  const before = today({ laterToday: [later(happyHour, "17:00")] })

  it("tags the category, the subcategory and the dish of an active promotion", () => {
    expect(categoryTag(now, bebidas)).toEqual({ promotionId: "p-hh", text: "2x1 · hasta 19:00", tone: "on" })
    expect(subcategoryTag(now, bebidas, COCTELES)).toEqual({ promotionId: "p-hh", text: "2x1 · hasta 19:00", tone: "on" })
    expect(dishTag(now, bebidas.dishes[0])).toEqual({ promotionId: "p-hh", text: "2x1 · hasta 19:00", tone: "on" })
  })

  it("leaves the rest untagged", () => {
    expect(categoryTag(now, fuertes)).toBeNull()
    expect(subcategoryTag(now, bebidas, "sub-cervezas")).toBeNull()
    expect(dishTag(now, bebidas.dishes[2])).toBeNull()
  })

  it("is yellow while ending and says desde HH:MM before it starts", () => {
    expect(dishTag(ending, bebidas.dishes[0])?.tone).toBe("ending")
    expect(categoryTag(before, bebidas)).toEqual({ promotionId: "p-hh", text: "2x1 desde 17:00", tone: "later" })
    expect(dishTag(before, bebidas.dishes[1])).toEqual({ promotionId: "p-hh", text: "2x1 desde 17:00", tone: "later" })
  })

  it("matches listed dishes and categories too", () => {
    const byDish = promotion({ id: "p-d", badge: "20%", kind: "product_discount", targets: { dishIds: [HAMB], categoryIds: [], subcategoryIds: [] } })
    const byCategory = promotion({ id: "p-c", badge: "3x2", targets: { dishIds: [], categoryIds: ["cat-bebidas"], subcategoryIds: [] } })
    expect(dishTag(today({ active: [active(byDish, null, null)] }), fuertes.dishes[0])).toEqual({ promotionId: "p-d", text: "20%", tone: "on" })
    expect(dishTag(today({ active: [active(byCategory, "23:00", 200)] }), bebidas.dishes[2])?.text).toBe("3x2 · hasta 23:00")
  })
})

describe("schedules", () => {
  it("writes days and hours in Spanish", () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe("de lunes a viernes")
    expect(daysText([2])).toBe("los martes")
    expect(daysText([1, 3, 5])).toBe("los lunes, miércoles y viernes")
    expect(daysText([6, 7])).toBe("los sábados y domingos")
    expect(daysText([])).toBe("todos los días")
    expect(hoursText([{ from: "12:00", to: "15:00" }])).toBe("de 12:00 a 15:00")
    expect(hoursText([])).toBe("todo el día")
  })

  it("builds the S12 toast from the promotion's days and hours", () => {
    expect(sellsText(menuEjecutivo)).toBe("El Menú ejecutivo se vende de lunes a viernes de 12:00 a 15:00")
  })

  it("abbreviates the schedule for tiles and cards", () => {
    expect(scheduleShort(menuEjecutivo)).toBe("Lun–Vie · 12:00–15:00")
    expect(scheduleShort(happyHour, { channels: true })).toBe("Lun–Vie · 17:00–19:00 · Salón")
  })
})

describe("Promociones de hoy (S11)", () => {
  it("groups Ahora, Más tarde hoy and the rest with their sentence", () => {
    const groups = sheetGroups(
      today({
        active: [active(happyHour, "19:00", 50)],
        laterToday: [later(menuEjecutivo, "20:00")],
        others: [other(promotion({ id: "p-dom", name: "10% en domicilios", channels: ["delivery"], sentence: "No aplica en el salón." }), "other_channel")],
      }),
    )
    expect(groups.now).toEqual([
      {
        id: "p-hh",
        name: "Happy hour 2x1 en cócteles",
        sentence: "En cócteles, de 5 a 7, pide 2 y paga 1; se pueden mezclar.",
        schedule: "Lun–Vie · 17:00–19:00 · Salón",
        tag: { text: "Hasta 19:00", tone: "on" },
      },
    ])
    expect(groups.later.map((card) => [card.name, card.tag.text])).toEqual([["Menú ejecutivo", "Desde 20:00"]])
    expect(groups.others.map((card) => [card.name, card.tag.text, card.sentence])).toEqual([["10% en domicilios", "Domicilio", "No aplica en el salón."]])
  })
})

describe("combo tiles (S12)", () => {
  it("enables a live combo and disables one outside its schedule", () => {
    expect(comboTiles(today({ active: [active(menuEjecutivo, "15:00", 150)] }))).toEqual([
      { promotion: menuEjecutivo, enabled: true, endsAt: "15:00", minutesLeft: 150, startsAt: null },
    ])
    expect(comboTiles(today({ others: [other(menuEjecutivo, "outside_hours")] }))).toEqual([
      { promotion: menuEjecutivo, enabled: false, endsAt: null, minutesLeft: null, startsAt: null },
    ])
    expect(comboTiles(today({ laterToday: [later(menuEjecutivo, "12:00")] }))[0]).toMatchObject({ enabled: false, startsAt: "12:00" })
  })

  it("leaves out combos of another channel and product promotions", () => {
    expect(comboTiles(today({ others: [other(menuEjecutivo, "other_channel")], active: [active(happyHour, "19:00", 50)] }))).toEqual([])
  })

  it("says the saving only when the parts cost more", () => {
    expect(comboSavingText(33000, 24000)).toEqual({ separate: expect.stringMatching(/^Por separado \$\s?33\.000$/), saving: expect.stringMatching(/^ahorra \$\s?9\.000$/) })
    expect(comboSavingText(24000, 24000).saving).toBeNull()
  })
})

describe("pricing preview", () => {
  const combo: ComboCartItem = {
    id: "combo-1",
    name: "Menú ejecutivo",
    price: 33000,
    quantity: 1,
    categoryId: "",
    image: "",
    combo: {
      promotionId: "p-ejec",
      comboPrice: 24000,
      listPrice: 33000,
      choices: [
        { groupId: "g-sopa", dishId: "d-ajiaco", name: "Ajiaco", price: 9000 },
        { groupId: "g-principio", dishId: "d-bandeja", name: "Bandeja", price: 17000 },
      ],
    },
  }
  const cart = [cartLine(MOJITO, "Mojito", 24000, 2), combo, cartLine(MARGARITA, "Margarita", 26000)]

  it("sends the cart as dish and combo draft lines, in order", () => {
    expect(previewDraft(cart)).toEqual({
      lines: [
        { dishId: MOJITO, quantity: 2 },
        { comboPromotionId: "p-ejec", choices: [{ groupId: "g-sopa", dishId: "d-ajiaco" }, { groupId: "g-principio", dishId: "d-bandeja" }] },
        { dishId: MARGARITA, quantity: 1 },
      ],
      lineIds: [cart[0].id, "combo-1", cart[2].id],
    })
  })

  const line = (overrides: Partial<PricingPreviewDto["lines"][number]>): PricingPreviewDto["lines"][number] => ({
    sent: false,
    orderItemId: null,
    draftIndex: null,
    dishId: null,
    name: "",
    quantity: 1,
    unitPrice: 0,
    promotionId: null,
    promotionName: null,
    comboId: null,
    addedAt: null,
    discounts: [],
    ...overrides,
  })
  const preview: PricingPreviewDto = {
    channel: "dine_in",
    now: "2026-11-12T23:10:00.000Z",
    lines: [
      line({ sent: true, orderItemId: "i-1", discounts: [{ kind: "promotion_item", promotionId: "p-hh", label: "Happy hour 2x1", amount: 24000 }] }),
      line({ draftIndex: 0, discounts: [{ kind: "promotion_item", promotionId: "p-hh", label: "Happy hour 2x1", amount: 24000 }] }),
      line({ draftIndex: 1, discounts: [{ kind: "combo", promotionId: "p-ejec", label: "Menú ejecutivo", amount: 9000 }] }),
      line({ draftIndex: 1 }),
    ],
    billDiscount: null,
    manualDiscounts: [],
    grossSubtotal: 0,
    totalDiscounts: 0,
    netSubtotal: 0,
    tax: null,
    tip: null,
    total: null,
    deliveryFee: null,
    hints: [],
  }

  it("puts each draft line's discounts on its cart line", () => {
    const rows = draftDiscounts(preview, previewDraft(cart).lineIds)
    expect(rows.get(cart[0].id)).toEqual([{ label: "Happy hour 2x1", amount: 24000 }])
    expect(rows.get("combo-1")).toEqual([{ label: "Menú ejecutivo", amount: 9000 }])
    expect(rows.has(cart[2].id)).toBe(false)
    expect(sentPreviewDiscounts(preview).get("i-1")).toEqual([{ label: "Happy hour 2x1", amount: 24000 }])
  })
})

describe("nudges (S11)", () => {
  const now = today({ active: [active(happyHour, "19:00", 50)] })
  const hint = { kind: "missing_units" as const, promotionId: "p-hh", message: "Falta 1 unidad para otro 2x1.", missing: 1 }

  it("offers the promotion's dishes, the ones on the order first", () => {
    const adds = quickAdds(hint, now, menu, [cartLine(MARGARITA, "Margarita", 26000)])
    expect(adds.map((add) => add.dish.name)).toEqual(["Margarita", "Mojito"])
  })

  it("warns to send in the last 10 minutes only with unsent eligible lines", () => {
    const ending = today({ active: [active(happyHour, "19:00", 8)] })
    expect(windowWarning(ending, menu, [cartLine(MOJITO, "Mojito", 24000)])).toEqual({ promotionId: "p-hh", endsAt: "19:00", minutesLeft: 8 })
    expect(windowWarning(ending, menu, [cartLine(HAMB, "Hamburguesa", 29000)])).toBeNull()
    expect(windowWarning(now, menu, [cartLine(MOJITO, "Mojito", 24000)])).toBeNull()
  })
})
