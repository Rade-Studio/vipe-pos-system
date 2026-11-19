import { waitFor, act, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * H-069: Transacciones names the order's waiter, finds a multi-method payment
 * by any of its methods, and keeps the shift's sales listed and reprintable
 * after the register closes.
 */

const env = vi.hoisted(() => ({ paymentIds: [] as string[][], paidOrders: vi.fn(), firstPage: vi.fn(), payments: null as unknown[] | null }))
const ORDER_1 = "abcdef12-0000-0000-0000-000000000000"
const ORDER_2 = "12345678-0000-0000-0000-000000000000"
const tender = (paymentMethodId: string, methodCode: string, amount: number, lineNo = 1) => ({
  lineNo, paymentMethodId, methodCode, methodKind: methodCode === "cash" ? "cash" : "electronic", amount, cashReceived: null,
})
vi.mock("@/lib/api/printing", () => ({ usePrintingEnabled: () => true }))
vi.mock("@/hooks/use-register-payments", () => ({
  useRegisterPayments: (ids: string[]) => {
    env.paymentIds.push(ids)
    return {
      isLoading: false,
      data: !ids.length
        ? []
        : env.payments ?? [
            {
              id: "p-1", orderId: ORDER_1, cashRegisterId: "r-1", cashierProfileId: "cashier-1",
              amountDue: 60000, tipAmount: 0, totalCharged: 60000, changeGiven: 0, idempotencyKey: "k1", createdAt: "2026-11-07T15:00:00.000Z",
              tenders: [tender("m-2", "nequi", 40000), tender("m-1", "cash", 20000, 2)],
            },
            {
              id: "p-2", orderId: ORDER_2, cashRegisterId: "r-1", cashierProfileId: "cashier-1",
              amountDue: 10000, tipAmount: 0, totalCharged: 10000, changeGiven: 0, idempotencyKey: "k2", createdAt: "2026-11-07T14:00:00.000Z",
              tenders: [tender("m-1", "cash", 10000)],
            },
          ],
    }
  },
}))
// `getRegisterPaidOrders` is the server's first page (newest 100); `getAllRegisterPaidOrders` pages through all.
vi.mock("@/lib/api/registers", () => ({ getRegisterPaidOrders: env.firstPage, getAllRegisterPaidOrders: env.paidOrders }))
vi.mock("@/lib/api/payments", () => ({
  listPaymentMethods: async () => [
    { id: "m-1", code: "cash", name: "Efectivo", kind: "cash", isActive: true, sortOrder: 1 },
    { id: "m-2", code: "nequi", name: "Nequi", kind: "electronic", isActive: true, sortOrder: 2 },
  ],
}))

import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useProfileStore } from "@/store/useProfileStore"
import { TransactionsList } from "./TransactionsList"

const paidRow = (orderId: string, paymentId: string, waiter: { id: string; name: string } | null) => ({
  orderId, orderNumber: 7, orderType: "dine_in", tableNumber: 3, zoneName: null, waiter, paymentId,
  amountDue: 0, tip: 0, total: 0, paidAt: new Date("2026-11-07T15:00:00.000Z"), tenders: [],
})

async function renderList(onReprint = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TransactionsList onReprint={onReprint} />
    </QueryClientProvider>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return onReprint
}
const rows = () => within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")
const search = (value: string) => fireEvent.change(screen.getByPlaceholderText("Buscar transacciones..."), { target: { value } })

beforeEach(() => {
  env.paymentIds = []
  env.payments = null
  env.firstPage.mockReset().mockImplementation(async () => (await env.paidOrders()).slice(0, 100))
  env.paidOrders.mockReset().mockResolvedValue([paidRow(ORDER_1, "p-1", { id: "w-1", name: "Ana Gómez" }), paidRow(ORDER_2, "p-2", null)])
  // The cashier is a known profile; the waiter is not in the local profile list.
  useProfileStore.setState({ profiles: [{ id: "cashier-1", name: "Caja Uno", role: "cashier" }] as never })
  useCashRegisterStore.setState({ currentRegister: { id: "r-1" } as never, lastClose: null })
})

describe("TransactionsList shift view (H-069)", () => {
  it("names the order's waiter, not the cashier, and never says Desconocido", async () => {
    await renderList()
    expect(env.paidOrders).toHaveBeenCalledWith("r-1")
    // The waiter names arrive with the paid-orders query: never "Sin mesero" while it loads.
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Ana Gómez"))
    expect(rows()[1]).toHaveTextContent("Sin mesero")
    expect(screen.queryByText("Caja Uno")).toBeNull()
    expect(screen.queryByText("Desconocido")).toBeNull()
  })

  it("finds a Nequi + Efectivo payment by either method and by the waiter's name", async () => {
    await renderList()
    search("nequi")
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent("Múltiples")
    search("EFECTIVO")
    expect(rows()).toHaveLength(2)
    search("ana")
    expect(rows()).toHaveLength(1)
    search("daviplata")
    expect(screen.getByText("No se encontraron transacciones que coincidan con la búsqueda")).toBeInTheDocument()
  })

  it("keeps the closed shift's sales listed and reprintable once the register closes", async () => {
    useCashRegisterStore.setState({ currentRegister: null, lastClose: { cashRegisterId: "r-1" } as never })
    const onReprint = await renderList()
    expect(env.paymentIds.at(-1)).toEqual(["r-1"])
    expect(screen.getByText("Caja cerrada: estas son las ventas del último turno.")).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "abcdef12" }))
    expect(onReprint).toHaveBeenCalledWith(ORDER_1)
  })

  it("with no open register and no close in this session lists nothing", async () => {
    useCashRegisterStore.setState({ currentRegister: null, lastClose: null })
    await renderList()
    expect(env.paymentIds.at(-1)).toEqual([])
    expect(env.paidOrders).not.toHaveBeenCalled()
    expect(screen.getByText("No hay transacciones registradas")).toBeInTheDocument()
  })

  it("names the waiter of the oldest payment of a shift longer than one page (117 payments)", async () => {
    const n = 117
    env.payments = Array.from({ length: n }, (_, i) => ({
      id: `p-${i}`, orderId: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`, cashRegisterId: "r-1", cashierProfileId: "cashier-1",
      amountDue: 1000, tipAmount: 0, totalCharged: 1000, changeGiven: 0, idempotencyKey: `k-${i}`,
      createdAt: new Date(Date.UTC(2026, 10, 7, 15, 0) - i * 60_000).toISOString(), tenders: [tender("m-1", "cash", 1000)],
    }))
    env.paidOrders.mockResolvedValue(
      Array.from({ length: n }, (_, i) => paidRow(`o-${i}`, `p-${i}`, { id: "w-x", name: i === n - 1 ? "Oldest Waiter" : "Otra Mesera" })),
    )
    await renderList()
    await waitFor(() => expect(rows()[n - 1]).toHaveTextContent("Oldest Waiter"))
    expect(screen.queryByText("Sin mesero")).toBeNull()
    search("oldest")
    expect(rows()).toHaveLength(1)
  })
})
