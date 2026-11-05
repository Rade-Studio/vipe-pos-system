import { readdirSync, readFileSync } from "node:fs"
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

  it("tags every image in the image job with a GHCR name only", () => {
    const ci = read(".github/workflows/ci.yml")
    const imageJob = ci.slice(ci.indexOf("  docker-build:"), ci.indexOf("  pos-deps-check:"))
    const tagLines = [...imageJob.matchAll(/tags: \|\n((?:\s{12}\S.*\n)+)/g)].flatMap((m) => m[1].trim().split("\n").map((l) => l.trim()))
    expect(tagLines.length).toBeGreaterThan(0)
    for (const tag of tagLines) expect(tag.startsWith("ghcr.io/rade-studio/")).toBe(true)
  })

  it("moves the branch tag only in the deploy job, after every check", () => {
    const ci = read(".github/workflows/ci.yml")
    const imageJob = ci.slice(ci.indexOf("  docker-build:"), ci.indexOf("  pos-deps-check:"))
    const deployJob = ci.slice(ci.indexOf("  deploy:"))
    expect(imageJob).not.toContain("github.ref_name")
    expect(deployJob).toContain("docker buildx imagetools create")
    expect(deployJob).toContain("packages: write")
    expect(deployJob.indexOf("imagetools create")).toBeLessThan(deployJob.indexOf("Deploy to Coolify"))
    // A re-run of an older run must not move the branch tag backwards.
    expect(deployJob.indexOf("is no longer the head of")).toBeGreaterThan(-1)
    expect(deployJob.indexOf("is no longer the head of")).toBeLessThan(deployJob.indexOf("imagetools create"))
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

  it("pulls every Coolify app image from GHCR by VIPE_IMAGE_TAG and builds nothing on the server", () => {
    const compose = read("docker-compose.coolify.yml")
    expect(compose).not.toMatch(/^\s*build:/m)
    for (const service of ["migrate", "api", "web"]) {
      const block = compose.match(new RegExp(`^  ${service}:\\n((?:    .*\\n|\\n)*)`, "m"))
      expect(block).not.toBeNull()
      expect(block![1]).toContain(`    image: ghcr.io/rade-studio/vipe-pos-${service}:\${VIPE_IMAGE_TAG:?}\n`)
      expect(block![1]).toContain("    pull_policy: always\n")
    }
  })

  it("pushes images from CI on dev and main only, and deploys only after the push", () => {
    const ci = read(".github/workflows/ci.yml")
    const job = ci.slice(ci.indexOf("\n  docker-build:"), ci.indexOf("\n  pos-deps-check:"))
    expect(job).toContain("registry: ghcr.io")
    expect(job).toContain("packages: write")
    for (const line of job.split("\n").filter((l) => /^\s*push:/.test(l))) {
      expect(line).toContain("${{ env.PUSH }}")
    }
    expect(job).toMatch(/PUSH: \$\{\{ github\.event_name == 'push' && \(github\.ref == 'refs\/heads\/main' \|\| github\.ref == 'refs\/heads\/dev'\) \}\}/)
    for (const image of ["api", "migrate", "web"]) expect(job).toContain(`ghcr.io/rade-studio/vipe-pos-${image}:`)
    const needs = ci.match(/\n  deploy:\n(?:    .*\n)*?    needs: \[([^\]]*)\]/)
    expect(needs).not.toBeNull()
    expect(needs![1].split(",").map((s) => s.trim())).toContain("docker-build")
  })

  it("passes VIPE_IMAGE_TAG to every local Coolify validation command", () => {
    const docs = [guide, read("DOCKER.md"), read("docker-compose.coolify.yml")].join("\n")
    const env = docs.split("\n").filter((line) => line.includes("VIPE_MIGRATOR_PASSWORD=") && line.includes("printf"))
    expect(env.length).toBe(3)
    for (const line of env) expect(line).toContain("VIPE_IMAGE_TAG=")
  })

  it("links only to existing despliegue.md anchors", () => {
    // GitHub's anchor: lowercase, punctuation dropped (accents, `_` and `-` kept), each space a hyphen.
    const slug = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/ /g, "-")
    const anchors = new Set(guide.split("\n").filter((l) => /^#{2,4} /.test(l)).map((l) => slug(l.replace(/^#+ /, ""))))
    const files = [...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`), "DOCKER.md"]
    const links = files.flatMap((f) => [...read(f).matchAll(/despliegue\.md#([^)\s]+)/g)].map((m) => m[1]))
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) expect(anchors).toContain(a)
  })

  it("describes the standalone Coolify database in the cut-over runbook", () => {
    expect(read("docs/runbook-cutover.md")).not.toMatch(/<contenedor-postgres>|`postgres` y `migrate` dejan/)
  })
})
