import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DeliveryTotals } from "./CashDayBoard"

/** H-080 (S3): the admin day and period show the delivery fees apart and per courier. */
describe("DeliveryTotals", () => {
  it("shows the fees apart from the food sales and, per courier, the cash they bring and the fees owed", () => {
    render(
      <DeliveryTotals
        fees={10000}
        foodSales={68000}
        couriers={[
          { courierId: "c-1", name: "Carlos", ordersCount: 2, cashCollected: 35000, feesOwed: 8000 },
          { courierId: null, name: null, ordersCount: 1, cashCollected: 10000, feesOwed: 2000 },
        ]}
      />,
    )
    const region = screen.getByRole("region", { name: "Domicilios" })
    expect(within(region).getByText("Ventas de comida").closest("p")).toHaveTextContent("$ 68.000")
    expect(within(region).getByText("Tarifas de domicilio").closest("p")).toHaveTextContent("$ 10.000")
    const [carlos, nobody] = within(within(region).getByRole("list", { name: "Domicilios por repartidor" })).getAllByRole("listitem")
    expect(carlos).toHaveTextContent("Carlos")
    expect(carlos).toHaveTextContent("2 domicilios")
    expect(carlos).toHaveTextContent(/Efectivo que trae\s*\$\s?35\.000/)
    expect(carlos).toHaveTextContent(/Tarifas que se le deben\s*\$\s?8\.000/)
    expect(nobody).toHaveTextContent("Sin repartidor")
  })

  it("says there were no deliveries", () => {
    render(<DeliveryTotals fees={0} foodSales={5000} couriers={[]} />)
    expect(within(screen.getByRole("region", { name: "Domicilios" })).getByText("Sin domicilios cobrados.")).toBeInTheDocument()
  })
})
