import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** F6 (S2) — the screens offer printing only when the restaurant uses thermal printers. */

const configApi = vi.hoisted(() => ({ fetchConfig: vi.fn() }))
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/config")>()),
  ...configApi,
}))

import { usePrintingEnabled } from "./printing"

function provider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => configApi.fetchConfig.mockReset())

describe("usePrintingEnabled", () => {
  it("is false once the config says printing is off", async () => {
    configApi.fetchConfig.mockResolvedValue({ printingEnabled: false })
    const { result } = renderHook(() => usePrintingEnabled(), { wrapper: provider() })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it("is true when printing is on and while the config loads", async () => {
    configApi.fetchConfig.mockResolvedValue({ printingEnabled: true })
    const on = renderHook(() => usePrintingEnabled(), { wrapper: provider() })
    expect(on.result.current).toBe(true)
    await waitFor(() => expect(configApi.fetchConfig).toHaveBeenCalled())
    expect(on.result.current).toBe(true)
  })

  it("is true without a query client (screens rendered outside the app shell)", () => {
    expect(renderHook(() => usePrintingEnabled()).result.current).toBe(true)
  })
})
