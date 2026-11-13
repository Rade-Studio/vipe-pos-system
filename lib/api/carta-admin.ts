import { AA, brandPalette, contrastRatio, LIGHT_CANVAS } from "@/lib/carta/brand"
import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { STORAGE_MESSAGES, validateImage } from "./storage"

/**
 * Ajustes · Carta digital (T8, S17): one read of everything the page shows,
 * the settings form, the dayparts list, per-dish tags and English text, the
 * slug and the table QR tokens. Only admins reach these routes.
 */

type Schemas = components["schemas"]
export type CartaAdmin = Schemas["CartaAdmin"]
export type CartaAdminSettings = Schemas["CartaAdminSettings"]
export type CartaAdminRestaurant = Schemas["CartaAdminRestaurant"]
export type CartaAdminDaypart = Schemas["CartaAdminDaypart"]
export type CartaAdminDish = Schemas["CartaAdminDish"]
export type CartaAdminTable = Schemas["CartaAdminTable"]
export type CartaAdminCategory = Schemas["CartaAdminCategory"]
export type CartaOpeningHours = Schemas["CartaOpeningHours"]
export type CartaOpeningDay = Schemas["CartaOpeningDay"]
export type DishTag = CartaAdminDish["tags"][number]
export type CartaAssetKind = Schemas["CreateCartaAssetRequest"]["kind"]
export type CartaDishDetails = Schemas["UpdateDishDetailsRequest"]

/** A daypart row while it is edited (no id: the save replaces the list). */
export type DaypartDraft = Pick<CartaAdminDaypart, "name" | "nameEn" | "startsAt" | "endsAt" | "featuredDishId" | "categoryIds">

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

export async function getCartaAdmin(): Promise<CartaAdmin> {
  const { data } = await api.GET("/api/carta-admin")
  return required(data)
}

const TEXT_FIELDS = [
  "description",
  "brandColor",
  "logoUrl",
  "coverUrl",
  "instagram",
  "tiktok",
  "whatsapp",
  "mapsUrl",
  "googleReviewUrl",
] as const

/** Trimmed text, blanks as null (the API clears a field on null). */
export function normalizeSettings(settings: CartaAdminSettings): CartaAdminSettings {
  const next = { ...settings }
  for (const field of TEXT_FIELDS) next[field] = blankToNull(settings[field])
  return next
}

export async function saveCartaSettings(settings: CartaAdminSettings): Promise<CartaAdminSettings> {
  const { data } = await api.PUT("/api/carta-admin/settings", { body: normalizeSettings(settings) })
  return required(data)
}

export async function saveDayparts(dayparts: readonly DaypartDraft[]): Promise<CartaAdminDaypart[]> {
  const { data } = await api.PUT("/api/carta-admin/dayparts", {
    body: {
      dayparts: dayparts.map((daypart, index) => ({
        name: daypart.name.trim(),
        nameEn: blankToNull(daypart.nameEn),
        startsAt: daypart.startsAt,
        endsAt: daypart.endsAt,
        sortOrder: index,
        featuredDishId: daypart.featuredDishId,
        categoryIds: daypart.categoryIds,
      })),
    },
  })
  return required(data)
}

export async function saveDishDetails(dishId: string, details: CartaDishDetails): Promise<Schemas["CartaDishDetails"]> {
  const { data } = await api.PUT("/api/carta-admin/dishes/{dishId}", {
    params: { path: { dishId } },
    body: { tags: details.tags, descriptionEn: blankToNull(details.descriptionEn), descriptionEnReviewed: details.descriptionEnReviewed },
  })
  return required(data)
}

export async function regenerateTableQr(tableId: string): Promise<CartaAdminTable> {
  const { data } = await api.POST("/api/carta-admin/tables/{tableId}/qr", { params: { path: { tableId } } })
  return required(data)
}

export async function regenerateAllQr(): Promise<CartaAdminTable[]> {
  const { data } = await api.POST("/api/carta-admin/tables/qr")
  return required(data).tables
}

export async function updateSlug(slug: string): Promise<CartaAdminRestaurant> {
  const { data } = await api.PUT("/api/carta-admin/slug", { body: { slug } })
  return required(data)
}

/** The API's own words for a taken (409) or malformed (422) slug. */
export function slugError(error: unknown): string {
  if (error instanceof ApiError && (error.status === 409 || error.status === 422)) return error.message
  return "No se pudo cambiar el enlace. Intenta de nuevo."
}

/** The logo and cover formats the API presigns (no GIF, no SVG). */
export const CARTA_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const
export type CartaImageType = (typeof CARTA_IMAGE_TYPES)[number]
export const CARTA_IMAGE_TYPE_MESSAGE = "Sube una imagen PNG, JPG o WebP (no SVG)."

function isCartaImageType(type: string): type is CartaImageType {
  return (CARTA_IMAGE_TYPES as readonly string[]).includes(type)
}

/**
 * Logo or cover: the API presigns a PUT under the restaurant's carta folder
 * and the browser sends the bytes straight to the bucket, as the dish image
 * upload (`lib/api/storage.ts`) does with its own route.
 */
export async function uploadCartaAsset(kind: CartaAssetKind, file: File): Promise<string> {
  const invalid = validateImage(file)
  if (invalid) throw new Error(invalid)
  const contentType = file.type.toLowerCase()
  if (!isCartaImageType(contentType)) throw new Error(CARTA_IMAGE_TYPE_MESSAGE)

  let ticket
  try {
    ticket = (await api.POST("/api/carta-admin/assets", { body: { kind, contentType, size: file.size } })).data
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) throw new Error(STORAGE_MESSAGES.unconfigured)
    throw error
  }
  if (!ticket) throw new Error(STORAGE_MESSAGES.upload)

  let response: Response
  try {
    response = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file })
  } catch {
    throw new Error(STORAGE_MESSAGES.upload)
  }
  if (!response.ok) throw new Error(STORAGE_MESSAGES.upload)
  return ticket.publicUrl
}

// ---------------------------------------------------------------------------
// Rules the form checks before a request (the API's own messages).

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SLUG_MAX = 64
export const SLUG_FORMAT_MESSAGE =
  "Usa minúsculas y números separados por guiones (sin tildes, espacios ni guiones al inicio o al final), hasta 64 caracteres."
export const DESCRIPTION_MAX = 160

export function slugHint(slug: string): string | null {
  if (slug === "") return "Escribe un nombre para el enlace."
  return slug.length <= SLUG_MAX && SLUG_PATTERN.test(slug) ? null : SLUG_FORMAT_MESSAGE
}

export function whatsappHint(value: string | null): string | null {
  if (!value) return null
  return /^\d{7,15}$/.test(value) ? null : "El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país."
}

const HANDLE = /^[A-Za-z0-9._]{1,30}$/

export function handleHint(value: string | null, network: "Instagram" | "TikTok"): string | null {
  if (!value?.trim()) return null
  return HANDLE.test(value.trim())
    ? null
    : `Escribe el usuario de ${network} sin @: letras, números, punto o guion bajo (máximo 30).`
}

export function httpsHint(value: string | null, label: "Google Maps" | "reseñas"): string | null {
  if (!value?.trim()) return null
  if (/^https:\/\/\S+$/.test(value.trim())) return null
  return label === "Google Maps"
    ? "El enlace de Google Maps debe empezar por https:// (máximo 500 caracteres)."
    : "El enlace para reseñas debe empezar por https:// (máximo 500 caracteres)."
}

/** Whether the carta's light theme keeps the picked color or steps it for AA (lib/carta/brand.ts). */
export function brandHint(color: string): { adjusted: boolean; used: string; message: string } {
  const used = brandPalette(color).light.brand
  const keeps = contrastRatio(color, "#ffffff") >= AA && contrastRatio(color, LIGHT_CANVAS) >= AA
  return keeps
    ? { adjusted: false, used, message: "Se lee bien sobre fondo claro y oscuro." }
    : { adjusted: true, used, message: `Lo ajustamos para que se lea bien: usamos ${used} en botones y textos.` }
}

/** A close earlier than (or equal to) the open is the next day's early hours. */
export function closesAfterMidnight(day: CartaOpeningDay): boolean {
  return day.closes <= day.opens
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Row index → the Spanish reason it cannot be saved. */
export function daypartErrors(dayparts: readonly DaypartDraft[]): Record<number, string> {
  const errors: Record<number, string> = {}
  dayparts.forEach((daypart, index) => {
    if (!daypart.name.trim()) errors[index] = "Escribe el nombre de la franja."
    else if (!HHMM.test(daypart.startsAt) || !HHMM.test(daypart.endsAt) || daypart.startsAt >= daypart.endsAt)
      errors[index] = "La franja debe empezar antes de terminar (no cruza la medianoche)."
  })
  return errors
}

export type SettingsField = keyof CartaAdminSettings

const FIELD_WORDS: [RegExp, SettingsField][] = [
  [/WhatsApp/i, "whatsapp"],
  [/Instagram/i, "instagram"],
  [/TikTok/i, "tiktok"],
  [/Google Maps/i, "mapsUrl"],
  [/reseñas/i, "googleReviewUrl"],
  [/descripción corta/i, "description"],
  [/color de marca/i, "brandColor"],
  [/logo/i, "logoUrl"],
  [/portada/i, "coverUrl"],
  [/horario/i, "openingHours"],
]

/** Which field a settings 422 is about, so the message shows next to it. */
export function fieldOfError(message: string): SettingsField | null {
  return FIELD_WORDS.find(([words]) => words.test(message))?.[1] ?? null
}

export function guestUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`
}
