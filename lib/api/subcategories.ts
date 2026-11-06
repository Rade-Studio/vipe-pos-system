import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Menu subcategories through the API (T8): the second step of a category in
 * the waiter and delivery pickers. Any staff role lists the active ones; the
 * admin editor also sees inactive ones and writes them. A duplicate name in
 * the category answers 409 `Ya existe una subcategoría con ese nombre en la
 * categoría`; deleting one that still has dishes 409 `La subcategoría tiene
 * platos; muévelos primero`.
 */

type Schemas = components["schemas"]
export type SubcategoryDto = Schemas["Subcategory"]
export type CreateSubcategoryBody = Schemas["CreateSubcategoryRequest"]
export type UpdateSubcategoryBody = Schemas["UpdateSubcategoryRequest"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

/** By category order, then sort order and name. `includeInactive` is admin only (403 otherwise). */
export async function getAll(options: { categoryId?: string; includeInactive?: boolean } = {}): Promise<SubcategoryDto[]> {
  const query = {
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options.includeInactive ? { includeInactive: "true" as const } : {}),
  }
  const { data } = await api.GET("/api/catalog/subcategories", { params: { query } })
  return required(data)
}

export async function create(body: CreateSubcategoryBody): Promise<SubcategoryDto> {
  const { data } = await api.POST("/api/catalog/subcategories", { body })
  return required(data)
}

export async function update(subcategoryId: string, body: UpdateSubcategoryBody): Promise<SubcategoryDto> {
  const { data } = await api.PATCH("/api/catalog/subcategories/{id}", { ...byId(subcategoryId), body })
  return required(data)
}

/** Position i gets sortOrder i, atomically; an id of another category (422) saves nothing. */
export async function reorder(categoryId: string, ids: string[]): Promise<SubcategoryDto[]> {
  const { data } = await api.PUT("/api/catalog/subcategories/order", { body: { categoryId, ids } })
  return required(data)
}

async function deleteSubcategory(subcategoryId: string): Promise<void> {
  await api.DELETE("/api/catalog/subcategories/{id}", byId(subcategoryId))
}
export { deleteSubcategory as delete }
