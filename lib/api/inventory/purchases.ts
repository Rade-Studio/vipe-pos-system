/**
 * Purchase orders. Header and lines are written in one transaction (create
 * and full-draft save); status moves draft -> ordered / cancelled (a trigger
 * assigns the number) and receiving goes through `receive_purchase_order`,
 * with the payment status in the same transaction. Totals and
 * `pendingQuantity` come from the server.
 */

import { api } from "@/lib/api/client"
import { byId, csv, defined, required } from "./shared"
import type {
  CreatePurchaseOrderInput,
  PaymentStatus,
  PurchaseOrder,
  PurchaseOrderFilters,
  ReceiveLineInput,
  ReceivePurchaseResult,
  UpdatePurchaseOrderInput,
} from "./types"

/** Newest first. */
export async function listPurchaseOrders(filters: PurchaseOrderFilters = {}): Promise<PurchaseOrder[]> {
  const { data } = await api.GET("/api/inventory/purchase-orders", {
    params: { query: defined({ status: csv(filters.status), supplierId: filters.supplierId }) },
  })
  return required(data)
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await api.GET("/api/inventory/purchase-orders/{id}", byId(id))
  return required(data)
}

/** Draft header and lines in one transaction: failed lines leave no draft. */
export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const { data } = await api.POST("/api/inventory/purchase-orders", { body: defined({ ...input }) })
  return required(data)
}

/**
 * Replaces the header and applies the line diff in one transaction: lines
 * with `lineId` are kept (and updated), lines without it are added, and the
 * order's other lines are removed. A `lineId` that is no longer a line of the
 * order answers 422.
 */
export async function updatePurchaseOrder(id: string, input: UpdatePurchaseOrderInput): Promise<PurchaseOrder> {
  const { data } = await api.PUT("/api/inventory/purchase-orders/{id}", { ...byId(id), body: defined({ ...input }) })
  return required(data)
}

export async function setPurchaseOrderStatus(id: string, status: "ordered" | "cancelled"): Promise<void> {
  await api.POST("/api/inventory/purchase-orders/{id}/status", { ...byId(id), body: { status } })
}

export async function setPurchaseOrderPaymentStatus(id: string, paymentStatus: PaymentStatus): Promise<void> {
  await api.POST("/api/inventory/purchase-orders/{id}/payment-status", { ...byId(id), body: { paymentStatus } })
}

/** Only draft orders can be deleted. */
export async function deletePurchaseOrder(id: string): Promise<void> {
  await api.DELETE("/api/inventory/purchase-orders/{id}", byId(id))
}

export async function receivePurchaseOrder(
  purchaseOrderId: string,
  lines: ReceiveLineInput[],
  paymentStatus?: PaymentStatus,
): Promise<ReceivePurchaseResult> {
  const { data } = await api.POST("/api/inventory/purchase-orders/{id}/receive", {
    ...byId(purchaseOrderId),
    body: defined({ lines: lines.map((line) => defined({ ...line })), paymentStatus }),
  })
  return required(data)
}
