import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { useProfileStore } from "@/store/useProfileStore"

vi.mock("@/lib/supabase/client", () => ({ supabase: {}, createSupabaseClient: () => ({}) }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

describe("ProfileSelection", () => {
  it("selects any role profile directly, without asking for a PIN", () => {
    const onSelectProfile = vi.fn()
    render(<ProfileSelection profiles={useProfileStore.getState().roleProfiles} onSelectProfile={onSelectProfile} />)

    for (const name of ["Mesero", "Cocina", "Caja", "Admin", "Domicilios"]) {
      fireEvent.click(screen.getAllByText(name)[0])
    }

    expect(onSelectProfile.mock.calls.map(([profile]) => profile.role)).toEqual([
      "waiter",
      "kitchen",
      "cashier",
      "admin",
      "delivery_operator",
    ])
    expect(screen.queryByText("Ingrese Contraseña")).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
