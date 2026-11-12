/**
 * Transfer documents (S3). A draft moves several items between two bodegas;
 * sending takes the stock out of the origin at once into a frozen in-transit
 * place (neither available nor counted in either bodega); receiving adds the
 * received quantity at the destination and writes a shortfall off as merma en
 * tránsito with its reason; cancelling before receipt returns the stock to the
 * origin. Every write answers the transfer as `getTransfer` does.
 */

import { api } from "@/lib/api/client"
import { byId, csv, defined, required } from "./shared"
import type { InventoryTransfer, ReceiveTransferLineInput, TransferFilters, TransferInput } from "./types"

/** Newest first, lines included. `locationId` matches the origin or the destination. */
export async function listTransfers(filters: TransferFilters = {}): Promise<InventoryTransfer[]> {
  const { data } = await api.GET("/api/inventory/transfers", {
    params: {
      query: defined({ status: csv(filters.status), locationId: filters.locationId, from: filters.from, to: filters.to }),
    },
  })
  return required(data)
}

export async function getTransfer(id: string): Promise<InventoryTransfer> {
  const { data } = await api.GET("/api/inventory/transfers/{id}", byId(id))
  return required(data)
}

/** A draft; a line above the origin stock answers 422 (P0001, `details` lists the shortages). */
export async function createTransfer(input: TransferInput): Promise<InventoryTransfer> {
  const { data } = await api.POST("/api/inventory/transfers", { body: defined({ ...input }) })
  return required(data)
}

/** Replaces the header and lines of a draft. */
export async function updateTransfer(id: string, input: TransferInput): Promise<InventoryTransfer> {
  const { data } = await api.PUT("/api/inventory/transfers/{id}", { ...byId(id), body: defined({ ...input }) })
  return required(data)
}

/** draft -> in_transit, all lines or none (422 with a Spanish message when the stock is short). */
export async function sendTransfer(id: string): Promise<InventoryTransfer> {
  const { data } = await api.POST("/api/inventory/transfers/{id}/send", byId(id))
  return required(data)
}

/** Every line once; a short line needs `shortfallReason`. Receiving again returns the stored transfer. */
export async function receiveTransfer(id: string, lines: ReceiveTransferLineInput[]): Promise<InventoryTransfer> {
  const { data } = await api.POST("/api/inventory/transfers/{id}/receive", {
    ...byId(id),
    body: { lines: lines.map((line) => defined({ ...line })) },
  })
  return required(data)
}

/** Drafts and transfers in transit only. */
export async function cancelTransfer(id: string): Promise<InventoryTransfer> {
  const { data } = await api.POST("/api/inventory/transfers/{id}/cancel", byId(id))
  return required(data)
}
