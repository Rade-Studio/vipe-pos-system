import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T8b (S3, S4) — tables and the waiters directory through the typed API
 * client. The server sets every timestamp and owns the release guard.
 */

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  assignWaiter,
  create,
  delete as deleteTable,
  getAll,
  getWaiters,
  releaseTable,
  reserveTable,
  saveLayout,
  toTable,
  toTableRow,
  update,
  setTableActive,
  updateTableStatus,
  type TableDto,
} from "./tables"

const table: TableDto = {
  id: "t-1",
  number: 4,
  status: "occupied",
  waiterId: "w-1",
  waiterName: "Ana",
  zoneId: "z-1",
  x: 0.25,
  y: 0.5,
  w: 0.1,
  h: 0.2,
  shape: "round",
  rotation: 45,
  seats: 6,
  isActive: true,
  createdAt: "2026-11-04T11:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
  reservationName: null,
  reservationArrivalAt: null,
  reservedAt: null,
  reservedByName: null,
}

const byId = { params: { path: { id: "t-1" } } }

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: table })
})

describe("mapping", () => {
  it("maps the DTO onto the store Table with the waiter and updated_at as Date", () => {
    expect(toTable(table)).toEqual({
      id: "t-1",
      number: 4,
      status: "occupied",
      waiter: "w-1",
      waiter_name: "Ana",
      zoneId: "z-1",
      x: 0.25,
      y: 0.5,
      w: 0.1,
      h: 0.2,
      shape: "round",
      rotation: 45,
      seats: 6,
      isActive: true,
      updated_at: new Date("2026-11-04T12:00:00.000Z"),
    })
    const unplaced = { zoneId: null, x: null, y: null, w: null, h: null, seats: null }
    expect(toTable({ ...table, ...unplaced, waiterId: null, waiterName: null, updatedAt: null })).toStrictEqual({
      id: "t-1",
      number: 4,
      status: "occupied",
      waiter: undefined,
      waiter_name: undefined,
      zoneId: undefined,
      x: undefined,
      y: undefined,
      w: undefined,
      h: undefined,
      shape: "round",
      rotation: 45,
      seats: undefined,
      isActive: true,
      updated_at: undefined,
      reservationName: undefined,
      reservationArrivalAt: undefined,
      reservedAt: undefined,
      reservedByName: undefined,
    })
    expect(toTable({ ...table, isActive: false }).isActive).toBe(false)
  })

  it("maps the DTO onto the pos_changes row shape the admin panel merges", () => {
    expect(toTableRow(table)).toEqual({
      id: "t-1",
      number: 4,
      status: "occupied",
      waiter_id: "w-1",
      waiter_name: "Ana",
      zone_id: "z-1",
      x: 0.25,
      y: 0.5,
      w: 0.1,
      h: 0.2,
      shape: "round",
      rotation: 45,
      seats: 6,
      updated_at: "2026-11-04T12:00:00.000Z",
      reservation_name: null,
      reservation_arrival_at: null,
      reserved_at: null,
      reserved_by_name: null,
    })
  })

  const reserved: TableDto = {
    ...table,
    status: "reserved",
    waiterId: null,
    waiterName: null,
    reservationName: "Familia López",
    reservationArrivalAt: "2026-11-07T01:30:00.000Z",
    reservedAt: "2026-11-06T22:00:00.000Z",
    reservedByName: "Ana",
  }

  it("toTable carries the reservation (T2, S2)", () => {
    expect(toTable(reserved)).toMatchObject({
      status: "reserved",
      reservationName: "Familia López",
      reservationArrivalAt: "2026-11-07T01:30:00.000Z",
      reservedAt: "2026-11-06T22:00:00.000Z",
      reservedByName: "Ana",
    })
  })

  it("toTableRow carries the reservation (T2, S2)", () => {
    expect(toTableRow(reserved)).toMatchObject({
      status: "reserved",
      reservation_name: "Familia López",
      reservation_arrival_at: "2026-11-07T01:30:00.000Z",
      reserved_at: "2026-11-06T22:00:00.000Z",
      reserved_by_name: "Ana",
    })
  })
})

describe("requests", () => {
  it("lists the tables and the waiters", async () => {
    api.GET.mockResolvedValueOnce({ data: [table] })
    await expect(getAll()).resolves.toEqual([table])
    expect(api.GET).toHaveBeenCalledWith("/api/tables")

    api.GET.mockResolvedValueOnce({ data: [{ id: "w-1", name: "Ana", username: "ana" }] })
    await expect(getWaiters()).resolves.toEqual([{ id: "w-1", name: "Ana", username: "ana" }])
    expect(api.GET).toHaveBeenLastCalledWith("/api/staff/waiters")
  })

  it("creates, updates and deletes without timestamps", async () => {
    await create({ number: 5, status: "available" })
    expect(api.POST).toHaveBeenCalledWith("/api/tables", { body: { number: 5, status: "available" } })

    await update("t-1", { number: 6, status: "reserved" })
    expect(api.PATCH).toHaveBeenCalledWith("/api/tables/{id}", { ...byId, body: { number: 6, status: "reserved" } })

    await updateTableStatus("t-1", "available")
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/tables/{id}", { ...byId, body: { status: "available" } })

    api.DELETE.mockResolvedValueOnce({ data: undefined })
    await deleteTable("t-1")
    expect(api.DELETE).toHaveBeenCalledWith("/api/tables/{id}", byId)
  })

  it("turns a table off and on with the table PATCH", async () => {
    api.PATCH.mockResolvedValueOnce({ data: { ...table, isActive: false } })
    await expect(setTableActive("t-1", false)).resolves.toMatchObject({ isActive: false })
    expect(api.PATCH).toHaveBeenCalledWith("/api/tables/{id}", { ...byId, body: { isActive: false } })
    await setTableActive("t-1", true)
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/tables/{id}", { ...byId, body: { isActive: true } })
  })

  it("saves the floor plan layout in one PUT and returns every table", async () => {
    const row = { id: "t-1", zoneId: "z-1", x: 0.25, y: 0.5, w: 0.1, h: 0.2, shape: "round" as const, rotation: 45, seats: 6 }
    api.PUT.mockResolvedValueOnce({ data: [table] })
    await expect(saveLayout([row])).resolves.toEqual([table])
    expect(api.PUT).toHaveBeenCalledWith("/api/tables/layout", { body: { tables: [row] } })
  })

  it("assigns a waiter and releases through the floor actions", async () => {
    await assignWaiter("t-1", "w-1")
    expect(api.POST).toHaveBeenCalledWith("/api/tables/{id}/assign", { ...byId, body: { waiterId: "w-1" } })

    await releaseTable("t-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/tables/{id}/release", { ...byId, body: {} })

    await releaseTable("t-1", { force: true })
    expect(api.POST).toHaveBeenLastCalledWith("/api/tables/{id}/release", { ...byId, body: { force: true } })
  })

  it("reserves a table under a name, with an optional arrival time", async () => {
    const reserved = { ...table, status: "reserved", reservationName: "Ana", reservedByName: "Luis" }
    api.POST.mockResolvedValue({ data: reserved })
    await expect(reserveTable("t-1", { name: "Ana" })).resolves.toEqual(reserved)
    expect(api.POST).toHaveBeenLastCalledWith("/api/tables/{id}/reserve", { ...byId, body: { name: "Ana" } })

    const arrivalAt = new Date(Date.now() + 3_600_000).toISOString()
    await reserveTable("t-1", { name: "Ana", arrivalAt })
    expect(api.POST).toHaveBeenLastCalledWith("/api/tables/{id}/reserve", { ...byId, body: { name: "Ana", arrivalAt } })
  })
})
