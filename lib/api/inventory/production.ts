/**
 * Production of preparations (`produce_preparation_on`, the daily bulk
 * `produce_preparations`), the batch history and the production templates.
 */

import { api } from "@/lib/api/client"
import { byId, defined, required } from "./shared"
import type {
  BatchListOptions,
  BulkProduceInput,
  BulkProduceResult,
  ProducePreparationInput,
  ProducePreparationResult,
  ProductionBatch,
  ProductionTemplate,
  ProductionTemplateInput,
} from "./types"

/** Newest producedOn first, optionally for one preparation and a producedOn range (server default limit 100). */
export async function listBatches(options: BatchListOptions = {}): Promise<ProductionBatch[]> {
  const { data } = await api.GET("/api/inventory/batches", {
    params: { query: defined({ itemId: options.itemId, limit: options.limit, from: options.from, to: options.to }) },
  })
  return required(data)
}

/** Insufficient stock rejects with P0001 whose `details` lists the shortages (see toInventoryError). */
export async function producePreparation(input: ProducePreparationInput): Promise<ProducePreparationResult> {
  const { data } = await api.POST("/api/inventory/production", { body: defined({ ...input }) })
  return required(data)
}

/**
 * Every line in one transaction, all or nothing. A shortage rejects with
 * P0001 whose `details` is a JSON `BulkProduceShortage[]`.
 */
export async function producePreparations(input: BulkProduceInput): Promise<BulkProduceResult> {
  const lines = input.lines.map((line) => defined({ ...line }))
  const { data } = await api.POST("/api/inventory/production/bulk", { body: defined({ ...input, lines }) })
  return required(data)
}

/** By name; admin only. */
export async function listProductionTemplates(): Promise<ProductionTemplate[]> {
  const { data } = await api.GET("/api/inventory/production-templates")
  return required(data)
}

/** 409 on a duplicate name, 422 when a line is not an active preparation. */
export async function createProductionTemplate(input: ProductionTemplateInput): Promise<ProductionTemplate> {
  const { data } = await api.POST("/api/inventory/production-templates", { body: input })
  return required(data)
}

export async function updateProductionTemplate(id: string, patch: Partial<ProductionTemplateInput>): Promise<ProductionTemplate> {
  const { data } = await api.PATCH("/api/inventory/production-templates/{id}", { ...byId(id), body: defined({ ...patch }) })
  return required(data)
}

export async function deleteProductionTemplate(id: string): Promise<void> {
  await api.DELETE("/api/inventory/production-templates/{id}", byId(id))
}
