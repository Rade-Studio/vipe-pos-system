import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * S4 guard (odd/tasks/migracion-backend-nestjs.md, T13b): the app talks to the
 * NestJS API only. This fails if a Supabase dependency, script or client layer
 * comes back.
 */
describe("S4: no Supabase dependency", () => {
  it("package.json has no supabase script or dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.scripts })
    expect(names.filter((name) => /supabase/i.test(name))).toEqual([])
    expect(Object.values(pkg.scripts ?? {}).filter((cmd) => /supabase/i.test(cmd))).toEqual([])
  })

  it("the Supabase client layer and project files are gone", () => {
    expect(existsSync("lib/supabase")).toBe(false)
    expect(existsSync("types/supabase.ts")).toBe(false)
    // Project files, not the folder: a local Supabase CLI may leave an untracked
    // supabase/.temp cache on developer machines.
    expect(existsSync("supabase/config.toml")).toBe(false)
    expect(existsSync("supabase/migrations")).toBe(false)
    expect(existsSync("supabase/functions")).toBe(false)
  })

  it("the lockfile has no @supabase package", () => {
    expect(readFileSync("pnpm-lock.yaml", "utf8")).not.toMatch(/@supabase\//)
  })
})
