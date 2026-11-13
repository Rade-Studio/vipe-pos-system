import type { components } from "@/lib/api/schema"

/** Response shapes of the public carta API (generated contract, T2). */
export type Carta = components["schemas"]["Carta"]
export type CartaDish = components["schemas"]["CartaDish"]
export type CartaCategory = components["schemas"]["CartaCategory"]
export type CartaDaypart = components["schemas"]["CartaDaypart"]
export type CartaModifierGroup = components["schemas"]["CartaModifierGroup"]
export type CartaDishShare = components["schemas"]["CartaDishShare"]
export type CartaLang = Carta["lang"]
export type DishTag = CartaDish["tags"][number]
