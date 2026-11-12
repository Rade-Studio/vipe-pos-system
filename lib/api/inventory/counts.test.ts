import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

/**
 * T5 (S5) — counts with a counter and an approver through the typed API
 * client, and every body the wrappers send accepted by the API's own zod
 * schema (read-only runtime import, as contract.test.ts does).
 */

const DTO_MODULE = "../../../apps/api/src/inventory/inventory.dto"
let dto: Record<string, ZodType>
beforeAll(async () => {
  dto = (await import(/* @vite-ignore */ DTO_MODULE)) as Record<string, ZodType>
})

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  getMyCount,
  listMyCounts,
  openCount,
  requestRecount,
  setCountReason,
  setMyCountedQuantity,
  startCount,
  submitCount,
  submitMyCount,
} from "./index"

const PROFILE = "11111111-1111-4111-8111-111111111111"
const ADMIN = "22222222-2222-4222-8222-222222222222"
const LINE = "66666666-6666-4666-8666-666666666666"
const COUNT = { id: "cnt-1", stage: "draft" }
const path = { params: { path: { id: "cnt-1" } } }

const body = (method: keyof typeof api): unknown => {
  const calls = api[method].mock.calls
  return JSON.parse(JSON.stringify(calls[calls.length - 1][1].body))
}
const accepts = (name: string, value: unknown) => {
  const parsed = dto[name].safeParse(value)
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: COUNT })
})

describe("counts with counter and approver (admin)", () => {
  it("prepares a count with both people", async () => {
    await openCount({ itemIds: [LINE], counterId: PROFILE, approverId: ADMIN })
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts", { body: { itemIds: [LINE], counterId: PROFILE, approverId: ADMIN } })
    accepts("openCountSchema", body("POST"))
  })

  it("starts, submits and sends lines back for recount", async () => {
    expect(await startCount("cnt-1")).toEqual(COUNT)
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/start", path)
    await submitCount("cnt-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/submit", path)
    await requestRecount("cnt-1", [LINE])
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/recount", { ...path, body: { lineIds: [LINE] } })
    accepts("recountSchema", body("POST"))
  })

  it("writes the reason of a line", async () => {
    await setCountReason("cnt-1", "line-1", "Vencido")
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/inventory/counts/{id}/lines/{lineId}", {
      params: { path: { id: "cnt-1", lineId: "line-1" } },
      body: { reason: "Vencido" },
    })
    accepts("countLineSchema", body("PATCH"))
  })
})

describe("my counts (the assigned counter, blind)", () => {
  it("lists and reads the counts assigned to the caller", async () => {
    api.GET.mockResolvedValue({ data: [] })
    expect(await listMyCounts()).toEqual([])
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/my-counts")
    api.GET.mockResolvedValue({ data: { ...COUNT, lines: [] } })
    expect(await getMyCount("cnt-1")).toEqual({ ...COUNT, lines: [] })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/my-counts/{id}", path)
  })

  it("counts a line and submits for review", async () => {
    api.PATCH.mockResolvedValue({ data: { id: "line-1", countedQuantity: 3 } })
    expect(await setMyCountedQuantity("cnt-1", "line-1", 3)).toEqual({ id: "line-1", countedQuantity: 3 })
    expect(api.PATCH).toHaveBeenLastCalledWith("/api/inventory/my-counts/{id}/lines/{lineId}", {
      params: { path: { id: "cnt-1", lineId: "line-1" } },
      body: { countedQuantity: 3 },
    })
    accepts("myCountLineSchema", body("PATCH"))
    await submitMyCount("cnt-1")
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/my-counts/{id}/submit", path)
  })
})
