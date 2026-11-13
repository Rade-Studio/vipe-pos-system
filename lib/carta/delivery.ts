import type { components } from "@/lib/api/schema"
import { api } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import { cartaPath } from "./share"
import { formatCop } from "./format"
import type { CartLine } from "./cart"
import { proposalItems } from "./table"

/**
 * The guest delivery checkout (T6 contract, L30; tax L33): the pricing
 * preview, sending the order, its tracking page and the WhatsApp fallback
 * (S16). From the browser, like the carta (A2).
 */

type Schemas = components["schemas"]
export type GuestPricing = Schemas["GuestPricing"]
export type GuestDeliveryStatus = Schemas["GuestDeliveryStatus"]
export type DeliveryStage = GuestDeliveryStatus["stage"]
export type PaymentMethod = Schemas["DeliveryPaymentRequest"]["method"]
export type DeliverySubmitRequest = Schemas["DeliverySubmitRequest"]

export interface DeliveryForm {
  name: string
  phone: string
  address: string
  neighborhood: string
  notes: string
  payment: PaymentMethod
  /** As typed: "$100.000". */
  cashFrom: string
}

export type DeliveryField = "name" | "phone" | "address" | "cashFrom"
export type DeliveryErrors = Partial<Record<DeliveryField, string>>

export const EMPTY_FORM: DeliveryForm = { name: "", phone: "", address: "", neighborhood: "", notes: "", payment: "cash", cashFrom: "" }

/* --------------------------------------------------------------- phone */

const PHONE_MAX = 15

/**
 * A4: the phone keeps digits only. Spaces, dashes, dots and parentheses are
 * dropped as typed; anything else (letters) is refused and the field keeps
 * its previous value, with the reason inline.
 */
export function phoneInput(raw: string, previous: string): { value: string; error: string | null } {
  const stripped = raw.replace(/[\s\-.()]/g, "")
  if (/\D/.test(stripped)) return { value: previous, error: "Escribe solo números." }
  if (stripped.length > PHONE_MAX) return { value: previous, error: `Máximo ${PHONE_MAX} dígitos.` }
  return { value: stripped, error: null }
}

/** "$100.000" → 100000; null when there are no digits. */
export function cashFromValue(raw: string): number | null {
  const digits = raw.replace(/\D/g, "")
  return digits ? Number(digits) : null
}

/** Artboard 01's checkout rules; `total` is the preview's amount due. */
export function validateDelivery(form: DeliveryForm, total: number): DeliveryErrors {
  const errors: DeliveryErrors = {}
  if (form.name.trim().length < 2) errors.name = "Escribe tu nombre."
  if (form.phone.length < 7 || form.phone.length > PHONE_MAX) errors.phone = "Escribe un celular de 10 dígitos, como 300 123 4567."
  if (form.address.trim().length < 6) errors.address = "Escribe la dirección completa."
  const cash = form.payment === "cash" ? cashFromValue(form.cashFrom) : null
  if (cash !== null && cash < total) errors.cashFrom = `Debe ser igual o mayor que el total (${formatCop(total)}).`
  return errors
}

export function deliveryBody(form: DeliveryForm, lines: readonly CartLine[]): DeliverySubmitRequest {
  const neighborhood = form.neighborhood.trim()
  const notes = form.notes.trim()
  const cashFrom = form.payment === "cash" ? cashFromValue(form.cashFrom) : null
  return {
    customer: {
      name: form.name.trim(),
      phone: form.phone,
      address: form.address.trim(),
      ...(neighborhood ? { neighborhood } : {}),
    },
    items: proposalItems(lines),
    payment: { method: form.payment, ...(cashFrom !== null ? { cashFrom } : {}) },
    ...(notes ? { notes } : {}),
  }
}

/* ----------------------------------------------------------------- calls */

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function fetchPricing(slug: string, lines: readonly CartLine[]): Promise<GuestPricing> {
  const { data } = await api.POST("/api/carta/{slug}/pricing-preview", {
    params: { path: { slug } },
    body: { channel: "delivery", items: proposalItems(lines) },
  })
  return required(data)
}

export async function submitDelivery(slug: string, body: DeliverySubmitRequest) {
  const { data } = await api.POST("/api/carta/{slug}/delivery", { params: { path: { slug } }, body })
  return required(data)
}

export async function fetchDeliveryStatus(slug: string, trackingToken: string): Promise<GuestDeliveryStatus> {
  const { data } = await api.GET("/api/carta/{slug}/delivery/{trackingToken}", { params: { path: { slug, trackingToken } } })
  return required(data)
}

/* -------------------------------------------------------------- tracking */

export function trackingPath(slug: string, trackingToken: string): string {
  return `${cartaPath(slug)}/d/${encodeURIComponent(trackingToken)}`
}

/** "Pedido D-0142". */
export function deliveryOrderLabel(orderNumber: number): string {
  return `D-${String(orderNumber).padStart(4, "0")}`
}

/** Recibido 0 → Confirmado 1 → En camino 2 → Entregado 3; -1 = off the steps. */
export const DELIVERY_STEP: Record<DeliveryStage, number> = {
  pending: 0,
  received: 1,
  preparing: 1,
  ready: 1,
  out_for_delivery: 2,
  delivered: 3,
  rejected: -1,
  failed: -1,
  cancelled: -1,
}

/** "Ver mi pedido" stops once the order is over for the guest: delivered, or off the steps (rejected, failed, cancelled). */
export function isTrackingDone(stage: DeliveryStage): boolean {
  return stage === "delivered" || DELIVERY_STEP[stage] < 0
}

export function trackingStorageKey(slug: string): string {
  return `vipe:carta:delivery:${slug}`
}

const TRACKING_TOKEN = /^[A-Za-z0-9_-]{16,64}$/

export function loadTrackingToken(storage: Pick<Storage, "getItem"> | undefined, slug: string): string | null {
  try {
    const stored = storage?.getItem(trackingStorageKey(slug))
    return stored && TRACKING_TOKEN.test(stored) ? stored : null
  } catch {
    return null
  }
}

/** The last order per restaurant; null forgets it. */
export function saveTrackingToken(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, slug: string, token: string | null): void {
  try {
    if (token) storage?.setItem(trackingStorageKey(slug), token)
    else storage?.removeItem(trackingStorageKey(slug))
  } catch {
    // Private mode or a full quota: the tracking link still works this visit.
  }
}

/* -------------------------------------------------------------- WhatsApp */

/** S16: the message the guest sends; the total is approximate (list prices + Envío). */
export function whatsappOrderText(restaurant: string, lines: readonly CartLine[], total: number): string {
  const rows = lines.map((l) => `${l.qty} × ${l.name}${l.options.length ? ` (${l.options.map((o) => o.name).join(", ")})` : ""}`)
  return [`Hola ${restaurant}, quiero pedir:`, ...rows, `Total aprox.: ${formatCop(total)}`].join("\n")
}

export function whatsappOrderHref(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`
}
