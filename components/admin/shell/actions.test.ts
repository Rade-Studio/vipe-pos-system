import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** T7 (S2): the admin shell signs out through the API, like the Header. */

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
const supabaseSignOut = vi.hoisted(() => vi.fn())
vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: { signOut: supabaseSignOut } } }))
const toast = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/use-toast", () => ({ toast, useToast: () => ({ toast }) }))

import { ApiError } from "@/lib/api/errors"
import { signOutAndLeave } from "./actions"

const location = { href: "/portal/admin" }

beforeEach(() => {
  api.POST.mockReset()
  toast.mockReset()
  supabaseSignOut.mockReset()
  supabaseSignOut.mockResolvedValue({ error: null })
  location.href = "/portal/admin"
  vi.stubGlobal("window", { location })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("signOutAndLeave", () => {
  it("calls POST /api/auth/logout, then reloads /portal", async () => {
    api.POST.mockResolvedValue({ data: undefined })

    await signOutAndLeave()

    expect(api.POST).toHaveBeenCalledWith("/api/auth/logout")
    expect(supabaseSignOut).toHaveBeenCalledWith({ scope: "local" })
    expect(location.href).toBe("/portal")
  })

  it("stays and shows the API message when the logout request fails", async () => {
    api.POST.mockRejectedValue(new ApiError(503, "Service Unavailable", "API caída"))

    await signOutAndLeave()

    expect(toast).toHaveBeenCalledWith({
      title: "Error al cerrar sesión",
      description: "API caída",
      variant: "destructive",
    })
    expect(location.href).toBe("/portal/admin")
  })
})
