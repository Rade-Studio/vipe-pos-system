import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

/**
 * T2 (S3) — transfer documents through the typed API client, and every body
 * the wrappers send accepted by the API's own zod schema (read-only runtime
 * import, as contract.test.ts does).
 */

const DTO_MODULE = "../../../apps/api/src/inventory/inventory.dto"
let dto: Record<string, ZodType>
beforeAll(async () => {
  dto = (await import(/* @vite-ignore */ DTO_MODULE)) as Record<string, ZodType>
})

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  cancelTransfer,
  createTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  sendTransfer,
  updateTransfer,
} from "./index"

const ITEM = "11111111-1111-4111-8111-111111111111"
const LOC = "33333333-3333-4333-8333-333333333333"
const LOC2 = "44444444-4444-4444-8444-444444444444"
const LINE = "66666666-6666-4666-8666-666666666666"
const TR = { id: "tr-1", status: "draft", lines: [] }

const body = (method: keyof typeof api): unknown => {
  const calls = api[method].mock.calls
  return JSON.parse(JSON.stringify(calls[calls.length - 1][1].body))
}
const accepts = (name: string, value: unknown) => {
  const parsed = dto[name].safeParse(value)
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ data: TR })
})

describe("transfers", () => {
  it("lists with only the given filters", async () => {
    api.GET.mockResolvedValue({ data: [] })
    await listTransfers()
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/transfers", { params: { query: {} } })
    await listTransfers({ status: ["draft", "in_transit"], locationId: LOC, from: "2026-11-01", to: "2026-11-12" })
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/transfers", {
      params: { query: { status: "draft,in_transit", locationId: LOC, from: "2026-11-01", to: "2026-11-12" } },
    })
  })

  it("gets one transfer", async () => {
    expect(await getTransfer("tr-1")).toEqual(TR)
    expect(api.GET).toHaveBeenLastCalledWith("/api/inventory/transfers/{id}", { params: { path: { id: "tr-1" } } })
  })

  it("creates and saves a draft with a body the API accepts", async () => {
    const input = { fromLocationId: LOC, toLocationId: LOC2, lines: [{ itemId: ITEM, quantity: 2.5 }] }
    expect(await createTransfer(input)).toEqual(TR)
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/transfers", { body: input })
    accepts("transferSchema", body("POST"))
    await updateTransfer("tr-1", { ...input, notes: null })
    expect(api.PUT).toHaveBeenLastCalledWith("/api/inventory/transfers/{id}", {
      params: { path: { id: "tr-1" } },
      body: { ...input, notes: null },
    })
    accepts("transferSchema", body("PUT"))
  })

  it("sends, receives and cancels, answering the transfer", async () => {
    expect(await sendTransfer("tr-1")).toEqual(TR)
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/transfers/{id}/send", { params: { path: { id: "tr-1" } } })
    await receiveTransfer("tr-1", [
      { lineId: LINE, receivedQuantity: 1, shortfallReason: "Bolsa rota" },
      { lineId: ITEM, receivedQuantity: 2 },
    ])
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/transfers/{id}/receive", {
      params: { path: { id: "tr-1" } },
      body: { lines: [{ lineId: LINE, receivedQuantity: 1, shortfallReason: "Bolsa rota" }, { lineId: ITEM, receivedQuantity: 2 }] },
    })
    accepts("receiveTransferSchema", body("POST"))
    expect(await cancelTransfer("tr-1")).toEqual(TR)
    expect(api.POST).toHaveBeenLastCalledWith("/api/inventory/transfers/{id}/cancel", { params: { path: { id: "tr-1" } } })
  })
})
