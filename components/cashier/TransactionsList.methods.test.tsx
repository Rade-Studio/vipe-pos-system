import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/** H-018: one summary card per method with movements, plus the active ones; no cap at four. */

const tender = (paymentMethodId: string, methodCode: string, amount: number, lineNo = 1) => ({
  lineNo, paymentMethodId, methodCode, methodKind: methodCode === "cash" ? "cash" : "electronic", amount, cashReceived: null,
})
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => true }))
vi.mock("@/hooks/use-register-payments", () => ({
  useRegisterPayments: () => ({
    isLoading: false,
    data: [
      {
        id: "p-1", orderId: "abcdef12-0000-0000-0000-000000000000", cashRegisterId: "r-1", cashierProfileId: null,
        amountDue: 60000, tipAmount: 0, totalCharged: 60000, changeGiven: 0, idempotencyKey: "k", createdAt: "2026-11-07T15:00:00.000Z",
        tenders: [tender("m-5", "bancolombia", 50000), tender("m-6", "bono", 10000, 2)],
      },
    ],
  }),
}))
const method = (id: string, name: string, isActive: boolean, sortOrder: number) => ({
  id, code: name.toLowerCase(), name, kind: id === "m-1" ? "cash" : "electronic", isActive, sortOrder,
})
vi.mock("@/lib/api/payments", () => ({
  listPaymentMethods: async () => [
    method("m-1", "Efectivo", true, 1),
    method("m-2", "Nequi", true, 2),
    method("m-3", "Daviplata", true, 3),
    method("m-4", "Tarjeta", true, 4),
    method("m-5", "Bancolombia", true, 5),
    method("m-6", "Bono", false, 6),
    method("m-7", "Cheque", false, 7),
  ],
}))

import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { TransactionsList } from "./TransactionsList"

beforeEach(() => {
  useCashRegisterStore.setState({ currentRegister: { id: "r-1" } as never })
})

describe("TransactionsList — method cards (H-018)", () => {
  it("shows every method with movements and every active one, never an inactive one without movements", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TransactionsList />
      </QueryClientProvider>,
    )
    const cards = await screen.findAllByTestId("method-card")
    expect(cards.map((card) => card.getAttribute("data-method"))).toEqual([
      "Efectivo", "Nequi", "Daviplata", "Tarjeta", "Bancolombia", "Bono",
    ])
    expect(screen.queryByText("Cheque")).not.toBeInTheDocument()
  })
})
