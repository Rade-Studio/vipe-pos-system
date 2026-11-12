import { api } from "./client"
import { ApiError } from "./errors"
import { orderConflictOf } from "./orders"
import type { CommandRequest } from "./print"
import type { components } from "./schema"

/**
 * The waiter's carta inbox (T5, S12/S14): guest proposals of open tables and
 * their requests ("pide la cuenta", "llama al mesero"). Confirming adds the
 * lines to the open order exactly as the waiter's send (stock, prices); it
 * does not print, so the caller queues the comanda (`kitchenCommandFor`).
 */

type Schemas = components["schemas"]
export type CartaInbox = Schemas["CartaInbox"]
export type InboxProposal = Schemas["InboxProposal"]
export type InboxRequest = Schemas["InboxRequest"]
export type ProposalConfirmed = Schemas["ProposalConfirmed"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

export async function getInbox(): Promise<CartaInbox> {
  const { data } = await api.GET("/api/carta-inbox")
  return required(data)
}

export async function confirmProposal(proposalId: string): Promise<ProposalConfirmed> {
  const { data } = await api.POST("/api/carta-inbox/proposals/{id}/confirm", byId(proposalId))
  return required(data)
}

/** The reason is shown to the guest; blank = none. */
export async function rejectProposal(proposalId: string, reason?: string | null): Promise<void> {
  await api.POST("/api/carta-inbox/proposals/{id}/reject", { ...byId(proposalId), body: { reason: reason?.trim() || null } })
}

export async function resolveRequest(requestId: string): Promise<void> {
  await api.POST("/api/carta-inbox/requests/{id}/resolve", byId(requestId))
}

/**
 * The comanda of a confirmed proposal, in the waiter send's print shape:
 * one line per proposal line, options as modifiers, the line note as the
 * kitchen comment. The added item ids go with the lines when they match one
 * to one. The proposal-level note stays in the inbox (A3).
 */
export function kitchenCommandFor(proposal: InboxProposal, orderItemIds: readonly string[]): CommandRequest {
  const withIds = orderItemIds.length === proposal.lines.length
  return {
    orderId: proposal.orderId,
    table: proposal.tableNumber,
    items: proposal.lines.map((line, index) => ({
      ...(withIds ? { id: orderItemIds[index] } : {}),
      dishId: line.dishId,
      name: line.name ?? "",
      quantity: line.quantity,
      ...(line.note ? { comments: line.note } : {}),
      ...(line.options.length ? { modifiers: line.options.map((o) => ({ group: "", name: o.name ?? "", price: 0 })) } : {}),
    })),
  }
}

/**
 * Staff-facing text of a refused confirm. The waiter send's own 409s come in
 * English and are read with the waiter app's mapping (`orderConflictOf`);
 * the carta API's 409/422 answers are already Spanish.
 */
export function confirmErrorMessage(error: unknown): string {
  const conflict = orderConflictOf(error)
  if (conflict?.kind === "shortage") {
    const items = conflict.shortages.map((s) => `${s.name} (se necesitan ${s.required} ${s.unit}, hay ${s.available} ${s.unit})`)
    return `No hay stock suficiente: ${items.join(", ")}.`
  }
  if (conflict?.kind === "priceChanged") return "Algunos precios cambiaron. Revisa la carta e intenta de nuevo."
  if (error instanceof ApiError && (error.status === 409 || error.status === 422 || error.status === 404)) return error.message
  return "No se pudo confirmar el pedido. Intenta de nuevo."
}
