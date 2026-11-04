import { beforeEach, describe, expect, it, vi } from "vitest"

/** T7b (S4) — the config store loads with `GET /config` and saves with one `PUT /config`. */

const config = vi.hoisted(() => ({ fetchConfig: vi.fn(), saveConfig: vi.fn() }))
vi.mock("@/lib/api/config", () => config)

import { useConfigStore } from "./use-config-store"

const server = {
  taxPercentage: 19,
  tipPercentage: 5,
  priceSuggestion: 250,
  businessName: "Vipe",
  businessAddress: "Calle 1",
  businessPhone: "300",
  businessNit: "900-1",
  inventoryControlEnabled: true,
  deliveryDefaultFee: 4000,
}

beforeEach(() => {
  config.fetchConfig.mockReset()
  config.saveConfig.mockReset()
  useConfigStore.setState({ error: null, isLoading: false })
})

describe("useConfigStore", () => {
  it("starts from the server defaults, not store-only values", () => {
    const state = useConfigStore.getInitialState()
    expect(state.taxPercentage).toBe(10)
    expect(state.businessName).toBe("Mi Restaurante")
    expect(state.businessNIT).toBe("123456789")
  })

  it("loads every value from GET /config", async () => {
    config.fetchConfig.mockResolvedValue(server)
    await useConfigStore.getState().loadConfigFromDB()

    expect(config.fetchConfig).toHaveBeenCalledTimes(1)
    expect(useConfigStore.getState()).toMatchObject({
      taxPercentage: 19,
      tipPercentage: 5,
      priceSuggestion: 250,
      businessName: "Vipe",
      businessAddress: "Calle 1",
      businessPhone: "300",
      businessNIT: "900-1",
      inventoryControlEnabled: true,
      isLoading: false,
      error: null,
    })
  })

  it("reports a failed load through error", async () => {
    config.fetchConfig.mockRejectedValue(new Error("boom"))
    await useConfigStore.getState().loadConfigFromDB()
    expect(useConfigStore.getState()).toMatchObject({ isLoading: false, error: "boom" })
  })

  it("saves the store values with one PUT /config in camelCase", async () => {
    config.saveConfig.mockResolvedValue(server)
    useConfigStore.setState({
      taxPercentage: 19,
      tipPercentage: 5,
      priceSuggestion: 250,
      inventoryControlEnabled: true,
      businessName: "Vipe",
      businessAddress: "Calle 1",
      businessPhone: "300",
      businessNIT: "900-1",
    })

    await useConfigStore.getState().saveConfigToDB()

    expect(config.saveConfig).toHaveBeenCalledTimes(1)
    expect(config.saveConfig).toHaveBeenCalledWith({
      taxPercentage: 19,
      tipPercentage: 5,
      priceSuggestion: 250,
      inventoryControlEnabled: true,
      businessName: "Vipe",
      businessAddress: "Calle 1",
      businessPhone: "300",
      businessNit: "900-1",
    })
    expect(useConfigStore.getState().error).toBeNull()
  })

  it("reports a failed save through error without throwing", async () => {
    config.saveConfig.mockRejectedValue(new Error("Forbidden resource"))
    await expect(useConfigStore.getState().saveConfigToDB()).resolves.toBeUndefined()
    expect(useConfigStore.getState().error).toBe("Forbidden resource")
  })
})
