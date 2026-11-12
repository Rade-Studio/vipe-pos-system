import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import type { OrderDto } from "./orders"

/**
 * The cashier's manual discounts (S7, S13): POST /orders/:id/discounts adds a
 * manual promotion or a free discount on a line or the order, DELETE removes a
 * manual one. Both answer the order with its discounts and bill recomputed.
 * A `manual_pin` promotion and a free discount carry an `apply_discount`
 * supervisor authorization (POST /auth/authorize, target the order).
 */

type Schemas = components["schemas"]
export type AddOrderDiscountBody = Schemas["AddOrderDiscountRequest"]

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function addOrderDiscount(orderId: string, body: AddOrderDiscountBody): Promise<OrderDto> {
  const { data } = await api.POST("/api/orders/{id}/discounts", { params: { path: { id: orderId } }, body })
  return required(data)
}

export async function removeOrderDiscount(orderId: string, discountId: string, authorizationId?: string): Promise<OrderDto> {
  const { data } = await api.DELETE("/api/orders/{id}/discounts/{discountId}", {
    params: { path: { id: orderId, discountId } },
    body: authorizationId ? { authorizationId } : {},
  })
  return required(data)
}

/** The API's refusals (422, 403, 409), in the words the cashier reads. */
const DISCOUNT_MESSAGES: Record<string, string> = {
  order_item_not_found: "El producto no está en la orden o ya fue anulado",
  promotion_not_found: "La promoción no existe",
  promotion_not_manual: "Esta promoción se aplica sola; no se puede agregar a mano",
  promotion_kind_unsupported: "Solo los descuentos por producto o por cuenta se aplican a mano",
  promotion_not_available: "La promoción no está vigente ahora para este canal",
  promotion_not_applicable: "La promoción no aplica a este producto",
  promotion_max_uses: "Esta promoción ya se usó el máximo de veces en la cuenta",
  promotion_min_subtotal: "La cuenta no llega al mínimo de esta promoción",
  discount_item_required: "Elige el producto al que se aplica la promoción",
  discount_item_not_allowed: "Esta promoción se aplica a la cuenta, no a un producto",
  discount_nothing_left: "No queda valor por descontar",
  discount_not_manual: "Los descuentos automáticos no se pueden quitar a mano",
  discount_not_found: "El descuento ya no está en la orden",
  authorization_required: "Esta acción necesita la autorización de un supervisor",
  authorization_invalid: "La autorización venció o ya se usó. Escribe el PIN otra vez.",
  self_authorization_not_allowed: "Otra persona con rol de supervisor debe autorizar esta acción",
  order_closed: "La orden está cerrada (pagada o cancelada)",
  order_not_found: "La orden no existe o ya no está disponible",
}

/** These send the cashier back to "¿Quién autoriza?". */
const REAUTHORIZE = new Set(["authorization_required", "authorization_invalid", "self_authorization_not_allowed"])

export interface DiscountRefusal {
  code: string | null
  message: string
  /** The authorization was missing or spent: pick a supervisor and type the PIN again. */
  reauthorize: boolean
}

export function discountRefusalOf(error: unknown): DiscountRefusal {
  if (error instanceof ApiError) {
    const code = typeof error.body.code === "string" ? error.body.code : null
    return {
      code,
      message: (code && DISCOUNT_MESSAGES[code]) || error.message,
      reauthorize: code !== null && REAUTHORIZE.has(code),
    }
  }
  return { code: null, message: "No se pudo aplicar. Revisa la conexión e inténtalo de nuevo.", reauthorize: false }
}
