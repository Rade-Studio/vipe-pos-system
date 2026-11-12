import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "./errors"

/** T7b (S4) — business config is read with `GET /config` and saved with one `PUT /config`. */

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { BUSINESS_DAY_CUTOFF_HOURS, CONFIG_QUERY_KEY, DEFAULT_BUSINESS_DAY_CUTOFF_HOUR, fetchConfig, saveConfig } from "./config"

const config = {
  taxPercentage: 10,
  tipPercentage: 10,
  priceSuggestion: 300,
  businessName: "Mi Restaurante",
  businessAddress: "Dirección del Restaurante",
  businessPhone: "123-456-7890",
  businessNit: "123456789",
  inventoryControlEnabled: false,
  deliveryDefaultFee: 0,
  businessDayCutoffHour: 4,
  taxType: "INC",
}

beforeEach(() => {
  api.GET.mockReset()
  api.PUT.mockReset()
})

describe("config", () => {
  it("reads the typed config with the server defaults", async () => {
    api.GET.mockResolvedValueOnce({ data: config })
    await expect(fetchConfig()).resolves.toEqual(config)
    expect(api.GET).toHaveBeenCalledWith("/api/config")
  })

  it("saves only the given keys and returns the full config", async () => {
    api.PUT.mockResolvedValueOnce({ data: { ...config, taxPercentage: 19 } })
    await expect(saveConfig({ taxPercentage: 19 })).resolves.toMatchObject({ taxPercentage: 19 })
    expect(api.PUT).toHaveBeenCalledWith("/api/config", { body: { taxPercentage: 19 } })
  })

  it("passes API errors through", async () => {
    api.PUT.mockRejectedValueOnce(new ApiError(403, "Forbidden", "Forbidden resource"))
    await expect(saveConfig({ taxPercentage: 19 })).rejects.toMatchObject({ status: 403 })
  })

  it("saves the business day cut-off hour (0..6, default 4)", async () => {
    api.PUT.mockResolvedValueOnce({ data: { ...config, businessDayCutoffHour: 2 } })
    await expect(saveConfig({ businessDayCutoffHour: 2 })).resolves.toMatchObject({ businessDayCutoffHour: 2 })
    expect(api.PUT).toHaveBeenCalledWith("/api/config", { body: { businessDayCutoffHour: 2 } })
    expect(DEFAULT_BUSINESS_DAY_CUTOFF_HOUR).toBe(4)
    expect(BUSINESS_DAY_CUTOFF_HOURS).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it("saves the tax type (INC | IVA) without touching the percentage", async () => {
    api.PUT.mockResolvedValueOnce({ data: { ...config, taxType: "IVA" } })
    await expect(saveConfig({ taxType: "IVA" })).resolves.toMatchObject({ taxType: "IVA", taxPercentage: 10 })
    expect(api.PUT).toHaveBeenCalledWith("/api/config", { body: { taxType: "IVA" } })
  })

  it("exposes one query key for every config reader", () => {
    expect(CONFIG_QUERY_KEY).toEqual(["config"])
  })
})
