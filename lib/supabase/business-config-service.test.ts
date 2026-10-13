import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T5 (S1): the shell used to run 8 sequential `business_config` reads
 * (`initializeDefaultConfig` -> `getConfigValue`) plus one more read
 * (`getAllConfig`), and every non-admin role's startup ended in 8 rejected
 * INSERTs because `business_config` writes are admin-only
 * (supabase/migrations/20261005150000_tenant_scope_remaining_tables.sql,
 * `business_config_insert_policy` requires `current_app_role() = 'admin'`).
 *
 * The client is mocked at the module the service imports, so the assertions
 * are about the exact request sequence the browser issues.
 */
const state = vi.hoisted(() => {
  const rows: { key: string; value: string }[] = []
  return {
    from: vi.fn(),
    select: vi.fn(),
    inserts: [] as unknown[][],
    insertError: null as unknown,
    readError: null as unknown,
    rows,
    reset() {
      this.from.mockReset()
      this.select.mockReset()
      this.inserts = []
      this.insertError = null
      this.readError = null
      this.rows = []
    },
  }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      state.from(table)
      const chain: any = {
        select: (cols: string) => {
          state.select(table, cols)
          return chain
        },
        eq: () => chain,
        single: () => chain,
        insert: (payload: unknown) => {
          const rows = Array.isArray(payload) ? payload : [payload]
          state.inserts.push(rows)
          const result = state.insertError
            ? { data: null, error: state.insertError }
            : { data: rows, error: null }
          const done: any = Promise.resolve(result)
          const tail: any = {}
          tail.select = () => tail
          tail.eq = () => tail
          tail.single = () => tail
          tail.insert = () => tail
          tail.update = () => tail
          tail.then = done.then.bind(done)
          return tail
        },
        update: () => chain,
        then: ((onfulfilled?: any) =>
          Promise.resolve(
            state.readError
              ? { data: null, error: state.readError }
              : { data: state.rows.map((r) => ({ id: r.key, key: r.key, value: r.value })), error: null },
          ).then(onfulfilled)) as any,
      }
      return chain
    },
  },
}))

import { businessConfigService, DEFAULT_CONFIG, missingConfigKeys } from "./business-config-service"

const ALL_KEYS = [
  "tax_percentage",
  "tip_percentage",
  "price_suggestion",
  "business_name",
  "business_address",
  "business_phone",
  "business_nit",
  "inventory_control_enabled",
] as const

beforeEach(() => {
  state.reset()
})

describe("missingConfigKeys", () => {
  it("returns every default key when nothing is stored", () => {
    expect(missingConfigKeys([])).toEqual(DEFAULT_CONFIG)
  })

  it("returns nothing when every default key is present", () => {
    expect(missingConfigKeys([...ALL_KEYS])).toEqual({})
  })

  it("returns only the keys that are actually missing, with their defaults", () => {
    expect(missingConfigKeys(["tax_percentage", "business_name"])).toEqual({
      tip_percentage: DEFAULT_CONFIG.tip_percentage,
      price_suggestion: DEFAULT_CONFIG.price_suggestion,
      business_address: DEFAULT_CONFIG.business_address,
      business_phone: DEFAULT_CONFIG.business_phone,
      business_nit: DEFAULT_CONFIG.business_nit,
      inventory_control_enabled: DEFAULT_CONFIG.inventory_control_enabled,
    })
  })

  it("ignores stored keys that are not defaults", () => {
    expect(missingConfigKeys([...ALL_KEYS, "some_retired_key"])).toEqual({})
  })
})

describe("loadConfig", () => {
  it("reads business_config exactly once when nothing is missing, and writes nothing", async () => {
    state.rows = ALL_KEYS.map((key) => ({ key, value: "1" }))

    const config = await businessConfigService.loadConfig()

    expect(state.from.mock.calls.map((c) => c[0])).toEqual(["business_config"])
    expect(state.select).toHaveBeenCalledTimes(1)
    expect(state.inserts).toEqual([])
    expect(config.tax_percentage).toBe(1)
  })

  it("reads once and inserts only the missing keys, in a single write", async () => {
    state.rows = [
      { key: "tax_percentage", value: "19" },
      { key: "business_name", value: "Vipe" },
    ]

    const config = await businessConfigService.loadConfig()

    expect(state.select).toHaveBeenCalledTimes(1)
    expect(state.inserts).toHaveLength(1)
    const inserted = Object.fromEntries(state.inserts[0].map((r: any) => [r.key, r.value]))
    expect(Object.keys(inserted).sort()).toEqual(
      [
        "tip_percentage",
        "price_suggestion",
        "business_address",
        "business_phone",
        "business_nit",
        "inventory_control_enabled",
      ].sort(),
    )
    expect(inserted.tip_percentage).toBe(String(DEFAULT_CONFIG.tip_percentage))
    expect(inserted.inventory_control_enabled).toBe(String(DEFAULT_CONFIG.inventory_control_enabled))
    // The stored values win over the defaults.
    expect(config.tax_percentage).toBe(19)
    expect(config.business_name).toBe("Vipe")
  })

  it("never writes for a role that cannot (canWrite: false), and still applies the read values", async () => {
    state.rows = [{ key: "tax_percentage", value: "19" }]

    const config = await businessConfigService.loadConfig({ canWrite: false })

    expect(state.select).toHaveBeenCalledTimes(1)
    expect(state.inserts).toEqual([])
    expect(config.tax_percentage).toBe(19)
    expect(config.business_name).toBe(DEFAULT_CONFIG.business_name)
  })

  it("keeps applying the config when seeding the missing keys fails", async () => {
    state.rows = [{ key: "tax_percentage", value: "19" }]
    state.insertError = { message: "new row violates row-level security policy" }

    const config = await businessConfigService.loadConfig()

    expect(config.tax_percentage).toBe(19)
    expect(config.business_name).toBe(DEFAULT_CONFIG.business_name)
  })

  it("propagates a failed read (the store turns it into its error state)", async () => {
    state.readError = { message: "boom" }

    await expect(businessConfigService.loadConfig()).rejects.toThrow()
  })
})

describe("getAllConfig", () => {
  it("still converts values by key type and keeps the defaults for absent rows", async () => {
    state.rows = [
      { key: "tax_percentage", value: "19" },
      { key: "inventory_control_enabled", value: "true" },
    ]

    const config = await businessConfigService.getAllConfig()

    expect(config.tax_percentage).toBe(19)
    expect(config.inventory_control_enabled).toBe(true)
    expect(config.business_nit).toBe(DEFAULT_CONFIG.business_nit)
  })

  it("returns price_suggestion as a number, like the store default (it used to leak the raw string)", async () => {
    state.rows = [{ key: "price_suggestion", value: "450" }]

    const config = await businessConfigService.getAllConfig()

    expect(config.price_suggestion).toBe(450)
    expect(typeof config.price_suggestion).toBe("number")
  })
})