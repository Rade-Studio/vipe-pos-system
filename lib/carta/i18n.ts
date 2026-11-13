import type { CartaLang, DishTag } from "./types"

/**
 * Guest carta copy (artboard 01, its `UI.es` / `UI.en`). Dish and category
 * names stay in Spanish (S10); only the interface and descriptions switch.
 */

const WEEKDAYS = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
}

export const TAG_LABELS: Record<CartaLang, Record<DishTag, string>> = {
  es: {
    vegetarian: "Vegetariano",
    spicy: "Picante",
    gluten_free: "Sin gluten",
    dairy: "Lácteos",
    most_ordered: "Lo más pedido",
  },
  en: {
    vegetarian: "Vegetarian",
    spicy: "Spicy",
    gluten_free: "Gluten-free",
    dairy: "Dairy",
    most_ordered: "Most ordered",
  },
}

function day(lang: CartaLang, inDays: number, date: string): string {
  if (inDays <= 0) return lang === "es" ? "hoy" : "today"
  if (inDays === 1) return lang === "es" ? "mañana" : "tomorrow"
  // The restaurant-local date: read it as a calendar day, not an instant.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return lang === "es" ? `el ${WEEKDAYS.es[weekday]}` : `on ${WEEKDAYS.en[weekday]}`
}

const es = {
  open: (closes: string) => `Abierto · cierra ${closes}`,
  openAlways: "Abierto",
  closed: "Cerrado ahora",
  closedSentence: (next: { inDays: number; date: string; opensAt: string } | null) =>
    next
      ? `Abrimos ${day("es", next.inDays, next.date)} a las ${next.opensAt}. Puedes ver la carta con calma.`
      : "Puedes ver la carta con calma.",
  table: (n: number, zone: string | null) => `Mesa ${n}${zone ? ` · ${zone}` : ""}`,
  delivery: "Domicilio",
  fee: (amount: string) => `Envío ${amount}`,
  share: "Compartir",
  switchLang: "Switch to English",
  langShort: "EN",
  instagram: (h: string) => `Instagram @${h}`,
  tiktok: (h: string) => `TikTok @${h}`,
  whatsapp: "WhatsApp del restaurante",
  maps: "Cómo llegar en Google Maps",
  social: "Redes del restaurante",
  dayparts: "Franja de la carta",
  now: "ahora",
  peek: (name: string, from: string, to: string) =>
    `Estás viendo la carta de ${name.toLocaleLowerCase("es-CO")} · se pide de ${from} a ${to}.`,
  special: "Plato del día",
  search: "Buscar en la carta",
  categories: "Categorías",
  noResults: (q: string) => `No hay platos con «${q}».`,
  clear: "Borrar búsqueda",
  soldOut: "Agotado hoy",
  other: "Otros",
  addList: (name: string) => `Agregar a mi lista: ${name}`,
  removeList: (name: string) => `Quitar de mi lista: ${name}`,
  openDish: (name: string, price: string, soldOut: boolean) => `${name}, ${price}${soldOut ? ", Agotado hoy" : ""}`,
  until: (time: string) => `hasta ${time}`,
  close: "Cerrar",
  required: "Obligatorio",
  optional: "Opcional",
  upTo: (n: number) => `Hasta ${n}`,
  choose: (group: string) => `Elige ${group.toLocaleLowerCase("es-CO")}`,
  note: "Comentario para la cocina (opcional)",
  notePlaceholder: "Ej.: sin chimichurri",
  add: (price: string) => `Agregar · ${price}`,
  orderDuring: (daypart: string) => `Se pide en ${daypart.toLocaleLowerCase("es-CO")}`,
  soldOutInfo: "Se acabó por hoy. Vuelve mañana o pregúntale al mesero por una alternativa.",
  shareCarta: "Compartir la carta",
  shareDish: "Compartir este plato",
  shareHint: "La imagen 9:16 se genera con la foto, el precio y un enlace corto.",
  orderHere: "Pídelo aquí",
  seeCarta: "Ver la carta",
  story: "Historia",
  copy: "Copiar enlace",
  copied: "Enlace copiado",
  copyFailed: "No se pudo copiar el enlace",
  noTable: "Sin la mesa: quien lo abra ve la carta, no tu cuenta.",
  tabMenu: "Carta",
  tabList: "Mi lista",
  tabs: "Secciones de la carta",
  seeList: "Ver mi lista",
  listTitle: "Mi lista",
  listIntro: "Este restaurante toma los pedidos en la mesa. Muéstrale esta lista a tu mesero.",
  listInfo: "La lista vive solo en tu celular: nada se envía a la cocina.",
  listEmpty: "Tu lista está vacía. Toca + en los platos que te antojen.",
  removeOne: (name: string) => `Quitar uno: ${name}`,
  addOne: (name: string) => `Agregar uno: ${name}`,
  added: (name: string) => `Agregado a tu lista: ${name}`,
  removed: (name: string) => `Quitado de tu lista: ${name}`,
  madeWith: "Hecho con VipePOS",
  pricesNote: "Precios con impuestos incluidos",
  loading: "Cargando la carta…",
  notFound: "No encontramos esta carta.",
  notFoundHint: "Revisa el enlace o pídele uno nuevo al restaurante.",
  error: "No pudimos cargar la carta.",
  errorHint: "Revisa tu conexión e inténtalo de nuevo.",
  retry: "Reintentar",
  rateLimited: "Demasiadas solicitudes. Intenta de nuevo en un momento.",
}

export type CartaStrings = typeof es

const en: CartaStrings = {
  open: (closes) => `Open · closes ${closes}`,
  openAlways: "Open",
  closed: "Closed now",
  closedSentence: (next) =>
    next
      ? `We open ${day("en", next.inDays, next.date)} at ${next.opensAt}. Feel free to browse the menu.`
      : "Feel free to browse the menu.",
  table: (n, zone) => `Table ${n}${zone ? ` · ${zone}` : ""}`,
  delivery: "Delivery",
  fee: (amount) => `Delivery fee ${amount}`,
  share: "Share",
  switchLang: "Cambiar a español",
  langShort: "ES",
  instagram: (h) => `Instagram @${h}`,
  tiktok: (h) => `TikTok @${h}`,
  whatsapp: "Restaurant WhatsApp",
  maps: "Directions on Google Maps",
  social: "Restaurant social links",
  dayparts: "Menu time of day",
  now: "now",
  peek: (name, from, to) => `You are viewing the ${name.toLowerCase()} menu · served ${from} to ${to}.`,
  special: "Today's special",
  search: "Search the menu",
  categories: "Categories",
  noResults: (q) => `No dishes match “${q}”.`,
  clear: "Clear search",
  soldOut: "Sold out today",
  other: "Other",
  addList: (name) => `Add to my list: ${name}`,
  removeList: (name) => `Remove from my list: ${name}`,
  openDish: (name, price, soldOut) => `${name}, ${price}${soldOut ? ", Sold out today" : ""}`,
  until: (time) => `until ${time}`,
  close: "Close",
  required: "Required",
  optional: "Optional",
  upTo: (n) => `Up to ${n}`,
  choose: (group) => `Choose ${group.toLowerCase()}`,
  note: "Note for the kitchen (optional)",
  notePlaceholder: "E.g. no chimichurri",
  add: (price) => `Add · ${price}`,
  orderDuring: (daypart) => `Order during ${daypart.toLowerCase()}`,
  soldOutInfo: "Sold out for today. Come back tomorrow or ask your waiter for an alternative.",
  shareCarta: "Share the menu",
  shareDish: "Share this dish",
  shareHint: "The 9:16 image is built from the photo, price and a short link.",
  orderHere: "Order it here",
  seeCarta: "See the menu",
  story: "Story",
  copy: "Copy link",
  copied: "Link copied",
  copyFailed: "Could not copy the link",
  noTable: "Without the table: whoever opens it sees the menu, not your bill.",
  tabMenu: "Menu",
  tabList: "My list",
  tabs: "Menu sections",
  seeList: "View my list",
  listTitle: "My list",
  listIntro: "This restaurant takes orders at the table. Show this list to your waiter.",
  listInfo: "The list lives only on your phone: nothing is sent to the kitchen.",
  listEmpty: "Your list is empty. Tap + on the dishes you fancy.",
  removeOne: (name) => `Remove one: ${name}`,
  addOne: (name) => `Add one: ${name}`,
  added: (name) => `Added to your list: ${name}`,
  removed: (name) => `Removed from your list: ${name}`,
  madeWith: "Made with VipePOS",
  pricesNote: "Prices include taxes",
  loading: "Loading the menu…",
  notFound: "No encontramos esta carta.",
  notFoundHint: "Check the link or ask the restaurant for a new one.",
  error: "We could not load the menu.",
  errorHint: "Check your connection and try again.",
  retry: "Try again",
  rateLimited: "Too many requests. Try again in a moment.",
}

/** S10 footer, in English whenever the carta is shown in English (A7). */
export const TRANSLATION_FOOTER = "Automatic translation reviewed by the restaurant."

export const STRINGS: Record<CartaLang, CartaStrings> = { es, en }
