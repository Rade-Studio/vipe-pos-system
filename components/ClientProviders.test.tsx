import { render, screen } from "@testing-library/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { queryClient } from "@/lib/queryClient"
import { ClientProviders } from "./ClientProviders"

/**
 * T5 (S1/S2): `ClientProviders` used to build its OWN `new QueryClient(...)`,
 * while six screens (`WaiterView`, `AdminView`, `KitchenView`, `CashierView`,
 * `PaymentMethodDialog`, `CashRegisterStatus`) import the separate instance
 * exported by `lib/queryClient.ts` to `setQueryData` / `invalidateQueries`.
 * Every `useQuery` read the provider's cache, so none of those writes ever
 * reached a screen — the exact "unnecessary requests" symptom of S1.
 */

let seen: unknown

// `next-themes` (rendered by ThemeProvider) reads `matchMedia` at mount and jsdom
// does not implement it. Scoped to this file: the shared vitest setup is not an
// edit surface for this task.
beforeAll(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
})

function ClientProbe() {
  seen = useQueryClient()
  return <div data-testid="probe">probe</div>
}

function CachedValueProbe() {
  // A queryFn that fails loudly: if the provider is NOT the shared client, the
  // seeded data is invisible and this query tries to fetch.
  const { data } = useQuery<{ value: string }>({
    queryKey: ["client-providers-shared-cache"],
    queryFn: async () => {
      throw new Error("the provider served a different cache")
    },
    staleTime: Infinity,
  })
  return <div data-testid="value">{data?.value ?? "no-data"}</div>
}

afterEach(() => {
  queryClient.clear()
  seen = undefined
})

describe("ClientProviders", () => {
  it("provides the very instance exported by lib/queryClient.ts", () => {
    render(
      <ClientProviders>
        <ClientProbe />
      </ClientProviders>,
    )

    expect(seen).toBe(queryClient)
  })

  it("serves data already cached on the shared client, without fetching", async () => {
    queryClient.setQueryData(["client-providers-shared-cache"], { value: "seeded" })

    render(
      <ClientProviders>
        <CachedValueProbe />
      </ClientProviders>,
    )

    expect(await screen.findByText("seeded")).toBeInTheDocument()
  })

  it("keeps the single set of default options (staleTime 30s, no refetch on focus, retry 2)", () => {
    const defaults = queryClient.getDefaultOptions().queries
    expect(defaults?.staleTime).toBe(30_000)
    expect(defaults?.refetchOnWindowFocus).toBe(false)
    expect(defaults?.retry).toBe(2)
  })
})