import { act, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * S1 (closes L23): the void sheet asks the void-aware pricing preview for the
 * selected quantity (debounced) and shows the recomputed discounts and total;
 * loading or a failed preview keeps the generic note.
 */

const orders = vi.hoisted(() => ({ getVoidPreview: vi.fn(), voidOrderItems: vi.fn(), cancelOrder: vi.fn() }))
vi.mock("@/lib/api/orders", async (importOriginal) => ({ ...(await importOriginal<object>()), ...orders }))
vi.mock("@/lib/api/config", () => ({ CONFIG_QUERY_KEY: ["config"], fetchConfig: async () => ({ allowSelfAuthorization: false }) }))

import { VoidFlow } from "./VoidFlow"
import type { VoidTarget } from "./flow"
import { VOID_PREVIEW_DEBOUNCE_MS } from "@/hooks/use-void-preview"
import { formatCurrency } from "@/utils/helpers"

const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "")

const target: VoidTarget = {
  action: "item",
  orderId: "o-1",
  label: "#128 · Mesa 7",
  lines: [{ id: "i-mojito", name: "Mojito", price: 24000, quantity: 3 }],
  lineId: "i-mojito",
  totalDiscounts: 38000,
}

function renderFlow(value: VoidTarget) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <VoidFlow target={value} actor={{ id: "c", name: "Laura", role: "cashier" }} loadSupervisors={async () => []} onDone={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(VOID_PREVIEW_DEBOUNCE_MS + 10)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  orders.getVoidPreview.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("VoidFlow — void-aware preview", () => {
  it("shows the recomputed discounts and total for the selected quantity", async () => {
    orders.getVoidPreview.mockResolvedValue({
      grossSubtotal: 117000,
      totalDiscounts: 24000,
      netSubtotal: 93000,
      total: 79000,
      lines: [{ orderItemId: "i-mojito", promotionName: "2x1" }],
    })
    renderFlow(target)
    await settle()
    expect(orders.getVoidPreview).toHaveBeenCalledWith({ orderId: "o-1", voids: [{ orderItemId: "i-mojito", quantity: 1 }] })
    const note = await screen.findByText("Si anulas 1 Mojito, el 2x1 se recalcula.")
    expect(squash(note.parentElement!.textContent)).toContain(squash(`Descuentos: −${formatCurrency(24000)} · Total: ${formatCurrency(79000)}`))
  })

  it("debounces quantity changes into one request for the last quantity", async () => {
    orders.getVoidPreview.mockResolvedValue({ grossSubtotal: 117000, totalDiscounts: 14000, netSubtotal: 50000, total: 54000, lines: [] })
    renderFlow(target)
    await settle()
    orders.getVoidPreview.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Uno más" }))
    fireEvent.click(screen.getByRole("button", { name: "Uno más" }))
    expect(orders.getVoidPreview).not.toHaveBeenCalled()
    await settle()
    expect(orders.getVoidPreview).toHaveBeenCalledTimes(1)
    expect(orders.getVoidPreview).toHaveBeenCalledWith({ orderId: "o-1", voids: [{ orderItemId: "i-mojito", quantity: 3 }] })
    expect(await screen.findByText("Si anulas 3 Mojito, las promociones se recalculan.")).toBeInTheDocument()
  })

  it("a failed preview falls back to the generic note", async () => {
    orders.getVoidPreview.mockRejectedValue(new Error("boom"))
    renderFlow(target)
    await settle()
    expect(screen.getByRole("note")).toHaveTextContent("Las promociones se recalculan al anular")
    expect(screen.queryByText(/Si anulas/)).not.toBeInTheDocument()
  })

  it("an order without discounts asks no preview", async () => {
    renderFlow({ ...target, totalDiscounts: 0 })
    await settle()
    expect(orders.getVoidPreview).not.toHaveBeenCalled()
    expect(screen.queryByRole("note")).not.toBeInTheDocument()
  })
})
