import { beforeEach, describe, expect, it, vi } from "vitest"

/** T17 (S8) — kitchen and delivery late thresholds from `GET /config`, saved with `PUT /config`. */

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import { DEFAULT_LATE_THRESHOLDS, fetchLateThresholds, lateThresholdsOf, saveLateThresholds } from "./settings"

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
  kitchenLateMinutes: 20,
  deliveryLateMinutes: 60,
}

beforeEach(() => {
  api.GET.mockReset()
  api.PUT.mockReset()
})

describe("late thresholds", () => {
  it("defaults to kitchen 25 and delivery 45 minutes, the server defaults", () => {
    expect(DEFAULT_LATE_THRESHOLDS).toEqual({ kitchenLateMinutes: 25, deliveryLateMinutes: 45 })
  })

  it("picks the two thresholds out of the config", () => {
    expect(lateThresholdsOf(config)).toEqual({ kitchenLateMinutes: 20, deliveryLateMinutes: 60 })
  })

  it("reads them with GET /config", async () => {
    api.GET.mockResolvedValueOnce({ data: config })
    await expect(fetchLateThresholds()).resolves.toEqual({ kitchenLateMinutes: 20, deliveryLateMinutes: 60 })
    expect(api.GET).toHaveBeenCalledWith("/api/config")
  })

  it("saves only the given threshold with PUT /config and returns both", async () => {
    api.PUT.mockResolvedValueOnce({ data: { ...config, kitchenLateMinutes: 10 } })
    await expect(saveLateThresholds({ kitchenLateMinutes: 10 })).resolves.toEqual({
      kitchenLateMinutes: 10,
      deliveryLateMinutes: 60,
    })
    expect(api.PUT).toHaveBeenCalledWith("/api/config", { body: { kitchenLateMinutes: 10 } })
  })
})
