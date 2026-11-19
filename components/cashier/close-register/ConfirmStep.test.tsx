import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { RegisterSummary } from "@/lib/payments/register-summary"
import { ConfirmStep } from "./ConfirmStep"

/** H-080 (S3): the close shows "Domicilios" apart from the sales and, per courier, the cash they bring and the fees owed. */
const summary: RegisterSummary = {
  registersCount: 1,
  initialCash: 10000,
  paymentsCount: 3,
  totalBilled: 68000,
  totalTips: 0,
  totalSales: 68000,
  totalChange: 0,
  methods: [
    { paymentMethodId: "m-cash", code: "cash", name: "Efectivo", kind: "cash", sortOrder: 10, isActive: true, total: 55000, tendersCount: 2 },
    { paymentMethodId: "m-nequi", code: "nequi", name: "Nequi", kind: "electronic", sortOrder: 30, isActive: true, total: 13000, tendersCount: 1 },
  ],
  cashDeposits: 0,
  cashWithdrawals: 0,
  expectedCash: 65000,
  tipsPayout: 0,
  expectedCashAfterTips: 65000,
  legacy: { paymentsCount: 0, total: 0, tips: 0, change: 0, byMethod: {} },
}
const delivery = {
  fees: 10000,
  ordersCount: 3,
  foodBilled: 58000,
  cashCollected: 45000,
  couriers: [
    { courierId: "c-1", name: "Carlos", ordersCount: 2, cashCollected: 35000, feesOwed: 8000 },
    { courierId: null, name: null, ordersCount: 1, cashCollected: 10000, feesOwed: 2000 },
  ],
}
const row = (label: string) => screen.getByText(label).closest("div") as HTMLElement

describe("ConfirmStep", () => {
  it("shows the food sales and the delivery fees apart, and per courier the cash they bring and the fees owed", () => {
    render(<ConfirmStep summary={{ ...summary, delivery }} counted={65000} note="" leftOpen={0} />)
    expect(row("Ventas de comida")).toHaveTextContent("$ 58.000")
    expect(row("Domicilios (3)")).toHaveTextContent("$ 10.000")
    const couriers = screen.getByRole("list", { name: "Domicilios por repartidor" })
    const [carlos, nobody] = within(couriers).getAllByRole("listitem")
    expect(carlos).toHaveTextContent("Carlos")
    expect(carlos).toHaveTextContent("2 domicilios")
    expect(carlos).toHaveTextContent(/Efectivo que trae\s*\$ 35\.000/)
    expect(carlos).toHaveTextContent(/Tarifas que se le deben\s*\$ 8\.000/)
    expect(nobody).toHaveTextContent("Sin repartidor")
    expect(nobody).toHaveTextContent("1 domicilio")
    expect(nobody).toHaveTextContent(/Efectivo que trae\s*\$ 10\.000/)
  })

  it("keeps the sales, the methods and the expected cash as they were", () => {
    render(<ConfirmStep summary={{ ...summary, delivery }} counted={65000} note="" leftOpen={0} />)
    expect(row("Ventas")).toHaveTextContent("$ 68.000")
    expect(row("Efectivo")).toHaveTextContent("$ 55.000")
    expect(row("Nequi")).toHaveTextContent("$ 13.000")
    expect(row("Esperado")).toHaveTextContent("$ 65.000")
  })

  it("shows no delivery lines for a shift without deliveries or a summary without the block", () => {
    const { unmount } = render(<ConfirmStep summary={summary} counted={null} note="" leftOpen={0} />)
    expect(screen.queryByText("Ventas de comida")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Domicilios por repartidor" })).not.toBeInTheDocument()
    unmount()
    render(<ConfirmStep summary={{ ...summary, delivery: { fees: 0, ordersCount: 0, foodBilled: 68000, cashCollected: 0, couriers: [] } }} counted={null} note="" leftOpen={0} />)
    expect(screen.queryByText("Ventas de comida")).not.toBeInTheDocument()
    expect(row("Esperado")).toHaveTextContent("$ 65.000")
  })
})
