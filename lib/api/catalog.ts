import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * Catalog through the API (T7b): categories, dishes and promotions as the
 * camelCase DTOs of the generated contract. The server owns the business
 * rules the web used to split with SQL: promotion pricing (`pricing:
 * "promotions"`), the "category has dishes" 409, cascading promotion deletes
 * and the atomic dish set of a promotion.
 *
 * Menu tree (T8): categories carry `sortOrder`, `color` and the derived
 * `hasSubcategories`; dishes carry `subcategoryId` (subcategory writes live in
 * `./subcategories`). `getMenuTree` is the waiter and delivery step picker's
 * one read, priced and with availability.
 *
 * Menu publication (T20): `getMenuTree` serves the latest publication's
 * structure with live prices, availability and modifier groups, plus the active
 * dishes without category in `uncategorized`; the admin editor reads the live
 * structure with `getMenuDraft`, the "n cambios sin publicar" status with
 * `getMenuPublication` and publishes with `publishMenu` (403 `Solo un
 * administrador puede publicar el menú`). Dishes carry `sortOrder`;
 * `reorderDishes` orders one group.
 *
 * Modifiers (F7): reusable groups with priced options (`fetchModifierGroups`
 * and the admin writes below); a dish offers groups through
 * `setDishModifierGroups` and carries its active groups, with live prices, in
 * `modifierGroups`. Quick notes are gone: a $0 option covers "Sin cebolla".
 */

type Schemas = components["schemas"]
export type CategoryDto = Schemas["Category"]
export type DishDto = Schemas["Dish"]
export type PromotionDto = Schemas["Promotion"]
export type CategoryColor = CategoryDto["color"]
export type MenuTreeDto = Schemas["MenuTree"]
export type MenuTreeCategoryDto = Schemas["MenuTreeCategory"]
export type MenuTreeDishDto = Schemas["MenuTreeDish"]
export type MenuPublicationDto = Schemas["MenuPublicationStatus"]
/** A dish group: a subcategory of a category, the category's loose dishes, or (null, null) the dishes without category. */
export type DishGroup = Pick<Schemas["DishOrderRequest"], "categoryId" | "subcategoryId">
export type CreateCategoryBody = Schemas["CreateCategoryRequest"]
export type UpdateCategoryBody = Schemas["UpdateCategoryRequest"]
export type CreateDishBody = Schemas["CreateDishRequest"]
export type UpdateDishBody = Schemas["UpdateDishRequest"]
export type CreatePromotionBody = Schemas["CreatePromotionRequest"]
export type UpdatePromotionBody = Schemas["UpdatePromotionRequest"]
export type ModifierGroupDto = Schemas["ModifierGroup"]
export type ModifierOptionDto = Schemas["ModifierOption"]
export type DishModifierGroupDto = Schemas["DishModifierGroup"]
export type CreateModifierGroupBody = Schemas["CreateModifierGroupRequest"]
export type UpdateModifierGroupBody = Schemas["UpdateModifierGroupRequest"]
export type CreateModifierOptionBody = Schemas["CreateModifierOptionRequest"]
export type UpdateModifierOptionBody = Schemas["UpdateModifierOptionRequest"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const flag = (value: boolean | undefined): "true" | "false" | undefined =>
  value === undefined ? undefined : value ? "true" : "false"

/** Drop undefined entries so the query string carries only the given filters. */
function defined<T extends Record<string, unknown>>(query: T): T {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as T
}

const byId = (id: string) => ({ params: { path: { id } } })

// ---- Categories -------------------------------------------------------------

export async function fetchCategories(filter: { active?: boolean } = {}): Promise<CategoryDto[]> {
  const { data } = await api.GET("/api/catalog/categories", {
    params: { query: defined({ active: flag(filter.active) }) },
  })
  return required(data)
}

export async function createCategory(body: CreateCategoryBody): Promise<CategoryDto> {
  const { data } = await api.POST("/api/catalog/categories", { body })
  return required(data)
}

export async function updateCategory(id: string, body: UpdateCategoryBody): Promise<CategoryDto> {
  const { data } = await api.PATCH("/api/catalog/categories/{id}", { ...byId(id), body })
  return required(data)
}

/** Position i gets sortOrder i, atomically; an unknown id (422) saves nothing. */
export async function reorderCategories(ids: string[]): Promise<CategoryDto[]> {
  const { data } = await api.PUT("/api/catalog/categories/order", { body: { ids } })
  return required(data)
}

/**
 * Rejects with the API's 409 `Category has dishes` when dishes still reference
 * it, or `La categoría tiene subcategorías; elimínalas primero`.
 */
export async function deleteCategory(id: string): Promise<void> {
  await api.DELETE("/api/catalog/categories/{id}", byId(id))
}

// ---- Dishes -----------------------------------------------------------------

export interface DishFilter {
  categoryId?: string
  subcategoryId?: string
  active?: boolean
  /** Apply the best promotion active now, server-side. */
  pricing?: "promotions"
}

/** Dishes ordered by name. */
export async function fetchDishes(filter: DishFilter = {}): Promise<DishDto[]> {
  const { data } = await api.GET("/api/catalog/dishes", {
    params: {
      query: defined({
        categoryId: filter.categoryId,
        subcategoryId: filter.subcategoryId,
        active: flag(filter.active),
        pricing: filter.pricing,
      }),
    },
  })
  return required(data)
}

/**
 * A subcategory outside the dish category answers 422 in Spanish; moving a dish
 * in a subcategory to another category needs `subcategoryId` (new or null).
 */
export async function createDish(body: CreateDishBody): Promise<DishDto> {
  const { data } = await api.POST("/api/catalog/dishes", { body })
  return required(data)
}

export async function updateDish(id: string, body: UpdateDishBody): Promise<DishDto> {
  const { data } = await api.PATCH("/api/catalog/dishes/{id}", { ...byId(id), body })
  return required(data)
}

/** Position i gets sortOrder i inside the group, atomically; an id of another group (422 `Unknown dish`) saves nothing. */
export async function reorderDishes(group: DishGroup, ids: string[]): Promise<DishDto[]> {
  const { data } = await api.PUT("/api/catalog/dishes/order", {
    body: { categoryId: group.categoryId, subcategoryId: group.subcategoryId, ids },
  })
  return required(data)
}

export async function deleteDish(id: string): Promise<void> {
  await api.DELETE("/api/catalog/dishes/{id}", byId(id))
}

// ---- Modifiers --------------------------------------------------------------

/** Groups by sortOrder with their options; `includeInactive` (admin, else 403) adds the inactive ones. */
export async function fetchModifierGroups(filter: { includeInactive?: boolean } = {}): Promise<ModifierGroupDto[]> {
  const { data } = await api.GET("/api/catalog/modifier-groups", {
    params: { query: defined({ includeInactive: flag(filter.includeInactive) }) },
  })
  return required(data)
}

/** Admin. 409 `Ya existe un grupo de modificadores con ese nombre`; 422 in Spanish for the min/max rules. */
export async function createModifierGroup(body: CreateModifierGroupBody): Promise<ModifierGroupDto> {
  const { data } = await api.POST("/api/catalog/modifier-groups", { body })
  return required(data)
}

export async function updateModifierGroup(id: string, body: UpdateModifierGroupBody): Promise<ModifierGroupDto> {
  const { data } = await api.PATCH("/api/catalog/modifier-groups/{id}", { ...byId(id), body })
  return required(data)
}

/** Also removes its options and dish links; lines already sent keep their options. */
export async function deleteModifierGroup(id: string): Promise<void> {
  await api.DELETE("/api/catalog/modifier-groups/{id}", byId(id))
}

/** Admin. 409 `Ya existe una opción con ese nombre en el grupo`; ingredientId and ingredientQty go together (422). */
export async function createModifierOption(groupId: string, body: CreateModifierOptionBody): Promise<ModifierOptionDto> {
  const { data } = await api.POST("/api/catalog/modifier-groups/{id}/options", { ...byId(groupId), body })
  return required(data)
}

export async function updateModifierOption(id: string, body: UpdateModifierOptionBody): Promise<ModifierOptionDto> {
  const { data } = await api.PATCH("/api/catalog/modifier-options/{id}", { ...byId(id), body })
  return required(data)
}

export async function deleteModifierOption(id: string): Promise<void> {
  await api.DELETE("/api/catalog/modifier-options/{id}", byId(id))
}

/** Admin. The group ids a dish offers, in order, inactive included. */
export async function fetchDishModifierGroups(dishId: string): Promise<string[]> {
  const { data } = await api.GET("/api/catalog/dishes/{id}/modifier-groups", byId(dishId))
  return required(data).groupIds
}

/** Admin. Replace the dish's groups with exactly `groupIds`, in order, atomically. */
export async function setDishModifierGroups(dishId: string, groupIds: string[]): Promise<string[]> {
  const { data } = await api.PUT("/api/catalog/dishes/{id}/modifier-groups", { ...byId(dishId), body: { groupIds } })
  return required(data).groupIds
}

// ---- Menu tree --------------------------------------------------------------

/** Active categories, subcategories and dishes in the published menu order, the same for waiter and delivery. */
export async function getMenuTree(): Promise<MenuTreeDto> {
  const { data } = await api.GET("/api/catalog/menu/tree")
  return required(data)
}

/** Admin. The tree from the live structure: what the next publication serves. */
export async function getMenuDraft(): Promise<MenuTreeDto> {
  const { data } = await api.GET("/api/catalog/menu/draft")
  return required(data)
}

/** Admin. Last publication time and publisher, and the structure changes since. */
export async function getMenuPublication(): Promise<MenuPublicationDto> {
  const { data } = await api.GET("/api/catalog/menu/publication")
  return required(data)
}

/** Admin. "Publicar a meseros": the live structure becomes the waiter and delivery menu. */
export async function publishMenu(): Promise<MenuPublicationDto> {
  const { data } = await api.POST("/api/catalog/menu/publish")
  return required(data)
}

// ---- Promotions -------------------------------------------------------------

/** Every promotion, newest first. */
export async function fetchPromotions(): Promise<PromotionDto[]> {
  const { data } = await api.GET("/api/catalog/promotions")
  return required(data)
}

export async function createPromotion(body: CreatePromotionBody): Promise<PromotionDto> {
  const { data } = await api.POST("/api/catalog/promotions", { body })
  return required(data)
}

export async function updatePromotion(id: string, body: UpdatePromotionBody): Promise<PromotionDto> {
  const { data } = await api.PATCH("/api/catalog/promotions/{id}", { ...byId(id), body })
  return required(data)
}

/** Also removes the promotion's dish assignments, in the same transaction. */
export async function deletePromotion(id: string): Promise<void> {
  await api.DELETE("/api/catalog/promotions/{id}", byId(id))
}

export async function fetchPromotionDishes(id: string): Promise<DishDto[]> {
  const { data } = await api.GET("/api/catalog/promotions/{id}/dishes", byId(id))
  return required(data)
}

/** Replace the promotion's dish set with exactly `dishIds`, atomically. */
export async function setPromotionDishes(id: string, dishIds: string[]): Promise<DishDto[]> {
  const { data } = await api.PUT("/api/catalog/promotions/{id}/dishes", { ...byId(id), body: { dishIds } })
  return required(data)
}
