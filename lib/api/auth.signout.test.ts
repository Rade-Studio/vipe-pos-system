// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

/** H-052: the waiter's table carts live in localStorage; signing out must not hand them to the next user. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }))

import { signOutAndReload } from "./auth"
import { CART_STORAGE_KEY } from "@/store/useCartStore"

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe("sign out", () => {
  it("forgets the saved table carts so the next user of a shared device starts empty (H-052)", async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ state: { cartItems: { t1: [{ id: "x" }] } }, version: 0 }))
    api.POST.mockResolvedValueOnce({ data: undefined, error: undefined, response: new Response(null, { status: 204 }) })
    vi.spyOn(window, "location", "get").mockReturnValue({ href: "" } as Location)
    await signOutAndReload()
    expect(api.POST).toHaveBeenCalledWith("/api/auth/logout")
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBeNull()
  })

  it("keeps the saved carts when the logout request fails (the user stays signed in)", async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, "{}")
    api.POST.mockRejectedValueOnce(new Error("offline"))
    await signOutAndReload()
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe("{}")
  })
})
