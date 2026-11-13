import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * The delivery console's carta requests (T6 contract, L30): guest delivery
 * orders waiting for the operator. Confirming creates the delivery order
 * through the console's own create (stock, kitchen command, customer by
 * phone); rejecting shows the reason to the guest.
 */

type Schemas = components["schemas"]
export type DeliveryInboxRequest = Schemas["DeliveryInboxRequest"]
export type DeliveryRequestConfirmed = Schemas["DeliveryRequestConfirmed"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

export async function getDeliveryRequests(): Promise<DeliveryInboxRequest[]> {
  const { data } = await api.GET("/api/carta-delivery")
  return required(data)
}

export async function confirmDeliveryRequest(requestId: string): Promise<DeliveryRequestConfirmed> {
  const { data } = await api.POST("/api/carta-delivery/{id}/confirm", byId(requestId))
  return required(data)
}

/** The reason is shown to the guest; blank = none. */
export async function rejectDeliveryRequest(requestId: string, reason?: string | null): Promise<void> {
  await api.POST("/api/carta-delivery/{id}/reject", { ...byId(requestId), body: { reason: reason?.trim() || null } })
}

/** The carta API's 404/409/422 answers are already Spanish; anything else reads the fallback. */
export function deliveryRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && [404, 409, 422].includes(error.status)) return error.message
  return fallback
}
