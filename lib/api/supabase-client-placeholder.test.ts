import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * T7 correction (item 1): the plain-Postgres dev stack runs without Supabase
 * variables. The legacy client must still load (inert placeholders), or every
 * page that imports a not-yet-migrated service answers 500. Lives here because
 * lib/supabase/** only gets the one-line fix in this task.
 */
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("lib/supabase/client without Supabase variables", () => {
  it("imports without throwing and exports a client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined)
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined)
    vi.resetModules()

    const mod = await import("@/lib/supabase/client")

    expect(mod.supabase).toBeDefined()
    expect(mod.createSupabaseClient()).toBe(mod.supabase)
  })
})
