import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import type { TableRow } from "@/lib/realtime/table-merge"
import type { Table, TableStatus } from "@/types"

/**
 * Tables and the waiters directory through the API (T8b). The server sets
 * every `updated_at` (no client clock reaches `mergeTableList`'s out-of-order
 * guard) and owns the release guard: releasing a table in kitchen, delivered,
 * served or reserved answers 409 `Table cannot be released while <status>`.
 */

type Schemas = components["schemas"]
export type TableDto = Schemas["Table"]
export type WaiterDto = Schemas["Waiter"]
export type UpdateTableBody = Schemas["UpdateTableRequest"]
/** One row of the editor's "Guardar cambios" (PUT /tables/layout). */
export type TableLayoutDto = Schemas["TableLayout"]

/** A 2xx without the body the contract promises. */
function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

const byId = (id: string) => ({ params: { path: { id } } })

/** API table -> the store `Table` (same shape `table-merge.toTable` builds from events). */
export function toTable(dto: TableDto): Table {
  return {
    id: dto.id,
    number: dto.number,
    status: dto.status,
    waiter: dto.waiterId ?? undefined,
    waiter_name: dto.waiterName ?? undefined,
    zoneId: dto.zoneId ?? undefined,
    x: dto.x ?? undefined,
    y: dto.y ?? undefined,
    w: dto.w ?? undefined,
    h: dto.h ?? undefined,
    shape: dto.shape,
    rotation: dto.rotation,
    seats: dto.seats ?? undefined,
    isActive: dto.isActive,
    updated_at: dto.updatedAt ? new Date(dto.updatedAt) : undefined,
  }
}

/** API table -> the `pos_changes` row shape, for screens that merge raw rows. */
export function toTableRow(dto: TableDto): TableRow & { id: string } {
  return {
    id: dto.id,
    number: dto.number,
    status: dto.status,
    waiter_id: dto.waiterId,
    waiter_name: dto.waiterName,
    zone_id: dto.zoneId,
    x: dto.x,
    y: dto.y,
    w: dto.w,
    h: dto.h,
    shape: dto.shape,
    rotation: dto.rotation,
    seats: dto.seats,
    updated_at: dto.updatedAt,
  }
}

/** Every table, ordered by number, with the waiter's name. */
export async function getAll(): Promise<TableDto[]> {
  const { data } = await api.GET("/api/tables")
  return required(data)
}

/** Admin. Without x, y, w, h the server places the table on the next free grid slot of its zone. */
export async function create(body: { number: number; status?: TableStatus } & Partial<Omit<TableLayoutDto, "id">>): Promise<TableDto> {
  const { data } = await api.POST("/api/tables", { body: body as Schemas["CreateTableRequest"] })
  return required(data)
}

/** Admin. `status: available` also clears the waiter unless `waiterId` is given. */
export async function update(tableId: string, body: UpdateTableBody): Promise<TableDto> {
  const { data } = await api.PATCH("/api/tables/{id}", { ...byId(tableId), body })
  return required(data)
}

/** Admin. An inactive table takes no new order (409 `La mesa está inactiva`) but stays listed, flagged. */
export async function setTableActive(tableId: string, isActive: boolean): Promise<TableDto> {
  return update(tableId, { isActive })
}

export async function updateTableStatus(tableId: string, status: TableStatus): Promise<TableDto> {
  return update(tableId, { status })
}

/**
 * Admin. Saves every row in one transaction: an unknown table, a zone of
 * another restaurant or an invalid value answers 422 and nothing is saved.
 * Resolves with every table after the save.
 */
export async function saveLayout(tables: TableLayoutDto[]): Promise<TableDto[]> {
  const { data } = await api.PUT("/api/tables/layout", { body: { tables } })
  return required(data)
}

/** Admin. 409 `Table has open orders` while any order of the table is not paid. */
async function deleteTable(tableId: string): Promise<void> {
  await api.DELETE("/api/tables/{id}", byId(tableId))
}
export { deleteTable as delete }

/** The waiter takes the table: `occupied`. */
export async function assignWaiter(tableId: string, waiterId: string): Promise<TableDto> {
  const { data } = await api.POST("/api/tables/{id}/assign", { ...byId(tableId), body: { waiterId } })
  return required(data)
}

/** `available` with no waiter; `force` (admin only) skips the status guard. */
export async function releaseTable(tableId: string, options: { force?: boolean } = {}): Promise<TableDto> {
  const body = (options.force ? { force: true } : {}) as Schemas["ReleaseTableRequest"]
  const { data } = await api.POST("/api/tables/{id}/release", { ...byId(tableId), body })
  return required(data)
}

/** Active waiters of the restaurant, by name. */
export async function getWaiters(): Promise<WaiterDto[]> {
  const { data } = await api.GET("/api/staff/waiters")
  return required(data)
}
