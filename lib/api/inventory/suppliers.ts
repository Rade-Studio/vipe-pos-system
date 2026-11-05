/** Suppliers. Soft-deleted through `isActive`. */

import { api } from "@/lib/api/client"
import { byId, required } from "./shared"
import type { Supplier, SupplierInput } from "./types"

/** By name. */
export async function listSuppliers(): Promise<Supplier[]> {
  const { data } = await api.GET("/api/inventory/suppliers")
  return required(data)
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const { data } = await api.POST("/api/inventory/suppliers", { body: input })
  return required(data)
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
  const { data } = await api.PATCH("/api/inventory/suppliers/{id}", { ...byId(id), body: input })
  return required(data)
}
