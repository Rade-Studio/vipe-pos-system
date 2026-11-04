import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * T7 (S2, S4): the browser only talks to its own origin. In development Next
 * proxies the API and the socket.io handshake to API_PROXY_TARGET, a server-side
 * variable; no NEXT_PUBLIC_* URL is inlined in the bundle.
 */
async function loadRewrites() {
  vi.resetModules()
  const { default: config } = await import("../../next.config.mjs")
  return config.rewrites!()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("next.config rewrites", () => {
  it("proxies /api and /socket.io to http://localhost:4000 by default", async () => {
    vi.stubEnv("API_PROXY_TARGET", undefined)
    expect(await loadRewrites()).toEqual([
      { source: "/api/:path*", destination: "http://localhost:4000/api/:path*" },
      { source: "/socket.io/:path*", destination: "http://localhost:4000/socket.io/:path*" },
    ])
  })

  it("follows API_PROXY_TARGET", async () => {
    vi.stubEnv("API_PROXY_TARGET", "http://api:4000/")
    expect(await loadRewrites()).toEqual([
      { source: "/api/:path*", destination: "http://api:4000/api/:path*" },
      { source: "/socket.io/:path*", destination: "http://api:4000/socket.io/:path*" },
    ])
  })

  it("keeps the existing build settings", async () => {
    vi.resetModules()
    const { default: config } = await import("../../next.config.mjs")
    expect(config.output).toBe("standalone")
    expect(config.images).toEqual({ unoptimized: true })
    expect(config.eslint).toEqual({ ignoreDuringBuilds: false })
  })
})
