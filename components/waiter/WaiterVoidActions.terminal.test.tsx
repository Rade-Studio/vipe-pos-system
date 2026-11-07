import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F4b: on a shared terminal "Anular plato" and "Cancelar orden" first ask the
 * waiter's PIN (the terminal's sheet); on a personal session they open the
 * void sheet at once.
 */

const auth = vi.hoisted(() => ({ identifyByPin: vi.fn() }))
vi.mock("@/lib/api/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/auth")>()), ...auth }))
vi.mock("@/components/voids/VoidFlow", () => ({
  VoidFlow: ({ target }: { target: { action: string } | null }) => (target ? <div>void-flow {target.action}</div> : null),
}))

import { TerminalView } from "@/components/terminal/TerminalView"
import { clearActingToken } from "@/lib/terminal/acting"
import { useProfileStore } from "@/store/useProfileStore"
import type { Order } from "@/types"
import { WaiterVoidActions } from "./WaiterVoidActions"

const order = {
  id: "o-1",
  tableId: "t-7",
  orderNumber: 12,
  items: [{ id: "i-1", name: "Arepa", price: 5000, quantity: 1, comments: "" }],
  bill: { total: 5000 },
} as unknown as Order
const opener = {
  user: { id: "u-laura", email: "laura@a.test" },
  profile: { id: "p-laura", name: "Laura Gómez", role: "cashier", restaurantId: "r-1" },
  sessionKind: "terminal" as const,
}

const renderIn = (terminal: boolean) => {
  const actions = <WaiterVoidActions order={order} tableNumber={7} />
  render(
    <QueryClientProvider client={new QueryClient()}>{terminal ? <TerminalView session={opener}>{actions}</TerminalView> : actions}</QueryClientProvider>,
  )
}

beforeEach(() => {
  auth.identifyByPin.mockReset().mockResolvedValue({
    token: "acting-p-andres",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    profile: { id: "p-andres", name: "Andrés", role: "waiter" },
  })
  useProfileStore.setState({ authProfile: null, selectedProfile: null })
  clearActingToken()
})

describe("WaiterVoidActions on a shared terminal (F4b)", () => {
  it.each([
    ["Anular Arepa", "item"],
    ["Cancelar orden", "order"],
  ])("%s asks the PIN first, then opens the void sheet as the identified waiter", async (button, action) => {
    renderIn(true)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: button }))
    })
    expect(screen.getByRole("heading", { name: "Mesa 7 · Escribe tu PIN" })).toBeInTheDocument()
    expect(screen.queryByText(/void-flow/)).toBeNull()
    const pad = within(screen.getByRole("group", { name: "Teclado del PIN" }))
    for (const digit of "4829") fireEvent.click(pad.getByRole("button", { name: digit }))
    await act(async () => {
      fireEvent.click(pad.getByRole("button", { name: "Entrar" }))
    })
    expect(screen.getByText(`void-flow ${action}`)).toBeInTheDocument()
    expect(useProfileStore.getState().selectedProfile?.id).toBe("p-andres")
  })

  it("closing the PIN sheet opens nothing", async () => {
    renderIn(true)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cerrar" }))
    })
    expect(screen.queryByText(/void-flow/)).toBeNull()
  })

  it("on a personal session opens the void sheet at once (unchanged)", async () => {
    renderIn(false)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancelar orden" }))
    })
    expect(screen.getByText("void-flow order")).toBeInTheDocument()
    expect(auth.identifyByPin).not.toHaveBeenCalled()
  })
})
