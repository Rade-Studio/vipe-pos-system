import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** F6 (S2) — the order id of a sale is a "reprint" action only when the restaurant uses printers. */

const printing = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => printing.enabled }))
vi.mock("@/hooks/use-register-payments", () => ({
  useRegisterPayments: () => ({
    isLoading: false,
    data: [
      {
        id: "p-1", orderId: "abcdef12-0000-0000-0000-000000000000", cashRegisterId: "r-1", cashierProfileId: null,
        amountDue: 10000, tipAmount: 0, totalCharged: 10000, changeGiven: 0, idempotencyKey: "k", createdAt: "2026-11-07T15:00:00.000Z",
        tenders: [],
      },
    ],
  }),
}))
vi.mock("@/lib/api/payments", () => ({ listPaymentMethods: async () => [] }))

import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { TransactionsList } from "./TransactionsList"

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TransactionsList />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  printing.enabled = true
  useCashRegisterStore.setState({ currentRegister: { id: "r-1" } as never })
})

describe("TransactionsList printing", () => {
  it("keeps the reprint action on the order id when printing is on", () => {
    renderList()
    expect(screen.getByRole("button", { name: "abcdef12" })).toBeInTheDocument()
  })

  it("shows the order id as text when the restaurant does not use printers", () => {
    printing.enabled = false
    renderList()
    expect(screen.getByText("abcdef12")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "abcdef12" })).not.toBeInTheDocument()
  })
})
