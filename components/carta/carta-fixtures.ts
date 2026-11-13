import type { Carta, CartaDish } from "@/lib/carta/types"

/** Test data shaped like `GET /api/carta/:slug` (artboard 01's "Brasa & Leña"). */

export function dish(overrides: Partial<CartaDish> & Pick<CartaDish, "id" | "name">): CartaDish {
  return {
    description: null,
    price: 10000,
    categoryId: null,
    subcategoryId: null,
    imageUrl: null,
    allowComments: false,
    available: true,
    tags: [],
    modifierGroups: [],
    ...overrides,
  }
}

export const LUNCH = "dp-almuerzo"
export const NIGHT = "dp-noche"

export function carta(overrides: Partial<Carta> = {}): Carta {
  const base: Carta = {
    lang: "es",
    channel: "delivery",
    restaurant: { name: "Brasa & Leña", slug: "brasa-y-lena", currency: "COP" },
    settings: {
      description: "Parrilla colombiana · Chapinero, Bogotá",
      brandColor: "#b4532a",
      logoUrl: null,
      coverUrl: null,
      instagram: "brasaylena",
      tiktok: null,
      // Set per test: a WhatsApp number turns the delivery carta into the S16 fallback.
      whatsapp: null,
      mapsUrl: null,
      googleReviewUrl: null,
      tableOrderingEnabled: false,
      deliveryOrderingEnabled: false,
      showTableBill: false,
      englishEnabled: true,
      openingHours: null,
    },
    isOpenNow: true,
    closesAt: "22:30",
    nextOpening: null,
    currentDaypartId: LUNCH,
    dayparts: [
      {
        id: LUNCH,
        name: "Almuerzo",
        nameEn: "Lunch",
        startsAt: "11:30",
        endsAt: "15:30",
        current: true,
        featuredDishId: "ejecutivo",
        categoryIds: ["c-fuertes", "c-bebidas"],
      },
      {
        id: NIGHT,
        name: "Noche",
        nameEn: "Evening",
        startsAt: "18:00",
        endsAt: "22:30",
        current: false,
        featuredDishId: null,
        categoryIds: ["c-cocteles"],
      },
    ],
    menu: {
      categories: [
        {
          id: "c-fuertes",
          name: "Platos fuertes",
          description: null,
          icon: "utensils",
          color: "#000000",
          hasSubcategories: false,
          subcategories: [],
          dishes: [
            dish({
              id: "churrasco",
              name: "Churrasco 300 g",
              price: 42900,
              description: "Corte madurado a la brasa de leña, chimichurri y un acompañante.",
              descriptionEn: "Aged cut over wood fire, chimichurri and one side.",
              tags: ["gluten_free", "most_ordered"],
              allowComments: true,
              modifierGroups: [
                {
                  id: "g-acomp",
                  name: "Acompañante",
                  required: true,
                  minSelect: 1,
                  maxSelect: 1,
                  options: [
                    { id: "o-papa", name: "Papa criolla", price: 0 },
                    { id: "o-arroz", name: "Arroz con coco", price: 3000 },
                  ],
                },
                {
                  id: "g-extra",
                  name: "Adiciones",
                  required: false,
                  minSelect: 0,
                  maxSelect: null,
                  options: [{ id: "o-chorizo", name: "Chorizo", price: 6000 }],
                },
              ],
            }),
            dish({
              id: "lasana",
              name: "Lasaña de berenjena",
              price: 29900,
              description: "Berenjena, ricota de la casa y salsa pomodoro.",
              tags: ["vegetarian", "dairy"],
            }),
            dish({ id: "ejecutivo", name: "Ejecutivo: sobrebarriga criolla", price: 21900, description: "Sopa, arroz y maduro." }),
          ],
        },
        {
          id: "c-bebidas",
          name: "Bebidas",
          description: null,
          icon: "cup",
          color: "#000000",
          hasSubcategories: false,
          subcategories: [],
          dishes: [
            dish({
              id: "coco",
              name: "Limonada de coco",
              price: 9900,
              description: "Cremosa, con coco natural.",
              promotionBadge: "2x1",
              promotionEndsAt: "16:00",
            }),
            dish({ id: "lulo", name: "Jugo de lulo", price: 7500, description: "En agua o en leche.", available: false }),
          ],
        },
        {
          id: "c-cocteles",
          name: "Cócteles",
          description: null,
          icon: "glass",
          color: "#000000",
          hasSubcategories: false,
          subcategories: [],
          dishes: [dish({ id: "mojito", name: "Mojito de maracuyá", price: 24000, tags: ["spicy"] })],
        },
      ],
      uncategorized: [],
    },
    deliveryFee: 4000,
    tipPercentage: 10,
  }
  return { ...base, ...overrides }
}

export const TABLE_TOKEN = "tok3n-abcdefghijklmnopqr"

export function tableCarta(overrides: Partial<Carta> = {}): Carta {
  return carta({ channel: "dine_in", table: { number: 12, zoneName: "Terraza", isOpen: true }, ...overrides })
}
