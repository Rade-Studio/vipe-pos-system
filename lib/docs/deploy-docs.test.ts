import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = join(__dirname, "..", "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")
const guide = read("docs/despliegue.md")

describe("deploy docs", () => {
  it("documents an R2 CORS rule that is valid JSON for browser uploads and reads", () => {
    const block = guide.match(/```json\n([\s\S]*?)```/)
    expect(block).not.toBeNull()
    const rules = JSON.parse(block![1]) as Array<{ AllowedMethods: string[]; AllowedHeaders: string[] }>
    expect(rules[0].AllowedMethods).toEqual(expect.arrayContaining(["PUT", "GET", "HEAD"]))
    expect(rules[0].AllowedHeaders).toContain("Content-Type")
  })

  it("passes an env file to every local Coolify validation command", () => {
    const lines = [guide, read("DOCKER.md")]
      .flatMap((doc) => doc.split("\n"))
      .filter((line) => line.includes("sed '/exclude_from_hc/d'"))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toContain("--env-file")
  })

  it("states the merge order before CI deploys the new stack to staging", () => {
    const section = guide.slice(guide.indexOf("### 3.3"), guide.indexOf("### 3.4"))
    const ordered = section.split("\n").filter((line) => /^\d+\. /.test(line)).join("\n")
    expect(ordered).toContain("COOLIFY_APP_UUID_STAGING")
    expect(ordered).toMatch(/`dev`/)
    expect(ordered).toContain("COOLIFY_APP_UUID_PRODUCTION")
  })

  it("documents the shared VPS MinIO provisioning and its CORS origin list", () => {
    expect(guide).toContain("provision-app.sh")
    expect(guide).toContain("MINIO_CORS_ORIGINS")
  })

  it("mounts no repository file in the Coolify compose, which Coolify does not ship next to it", () => {
    const compose = read("docker-compose.coolify.yml")
    const repoMounts = compose.split("\n").filter((line) => /^\s*-\s*\.{1,2}\//.test(line))
    expect(repoMounts).toEqual([])
  })

  it("mounts no repository path in long or quoted form in the Coolify compose either", () => {
    const repoMounts = read("docker-compose.coolify.yml")
      .split("\n")
      .filter((line) => /^\s*-\s*["']\.{1,2}\//.test(line) || /^\s*(-\s*)?source:\s*["']?\.{1,2}\//.test(line))
    expect(repoMounts).toEqual([])
  })

  it("keeps Postgres out of the Coolify compose and reaches it through DATABASE_HOST", () => {
    const compose = read("docker-compose.coolify.yml")
    expect(compose).not.toMatch(/^  postgres:/m)
    expect(compose).not.toContain("postgres_data")
    const urls = compose.split("\n").filter((line) => /^\s*DATABASE_URL:/.test(line))
    expect(urls).toHaveLength(2)
    for (const url of urls) expect(url).toContain("@${DATABASE_HOST:?}:${DATABASE_PORT:-5432}/")
  })

  it("passes DATABASE_HOST to every local Coolify validation command", () => {
    const docs = [guide, read("DOCKER.md"), read("docker-compose.coolify.yml")].join("\n")
    const env = docs.split("\n").filter((line) => line.includes("VIPE_MIGRATOR_PASSWORD=") && line.includes("printf"))
    expect(env.length).toBe(3)
    for (const line of env) expect(line).toContain("DATABASE_HOST=")
  })
})
