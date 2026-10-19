import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/lib/supabase/client", () => ({ supabase: { auth: {} }, createSupabaseClient: () => ({}) }))
vi.mock("@/components/theme/theme-toggle", () => ({ ThemeToggle: () => null }))

import { LoginView } from "@/components/auth/LoginView"

describe("LoginView", () => {
  it("names the product VipePOS, never the old VibePOS spelling", () => {
    render(<LoginView onLoginSuccess={() => {}} />)

    expect(screen.getAllByText(/VipePOS/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/VibePOS/)).toBeNull()
  })
})
