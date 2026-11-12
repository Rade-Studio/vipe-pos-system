import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CountAdjustmentPrint } from "./CountAdjustmentPrint"
import { CountSheetPrint } from "./CountSheetPrint"

const header = {
  number: 14,
  locationName: "Cocina caliente",
  counterName: "Andrés Gómez",
  approverName: "Mariana Restrepo",
  date: new Date(2026, 10, 12, 22, 0),
}

describe("count prints", () => {
  it("Hoja de conteo is blind, grouped, with unit, a blank column and signatures", () => {
    render(
      <CountSheetPrint
        header={header}
        lines={[
          { name: "Pechuga de pollo", sku: "MP-0004", unit: "kg", group: "Proteínas" },
          { name: "Arroz", sku: "MP-0007", unit: "kg", group: "Secos" },
        ]}
      />,
    )
    const doc = screen.getByRole("document", { name: "Hoja de conteo" })
    expect(doc).toHaveTextContent("Hoja de conteo · Conteo #14")
    expect(doc).toHaveTextContent("Cocina caliente")
    expect(doc).toHaveTextContent(/2026/)
    expect(within(doc).getByText("Proteínas")).toBeInTheDocument()
    expect(within(doc).getByText("Secos")).toBeInTheDocument()
    expect(within(doc).getByRole("columnheader", { name: "Cantidad" })).toBeInTheDocument()
    expect(within(doc).getAllByRole("cell", { name: "kg" })).toHaveLength(2)
    expect(doc).toHaveTextContent("Contó: Andrés Gómez · firma")
    expect(doc).toHaveTextContent("Revisó: Mariana Restrepo · firma")
    expect(doc).not.toHaveTextContent(/Sistema|Esperado/)
  })

  it("Acta de ajuste shows expected vs counted, differences in units and COP, the total and signatures", () => {
    render(
      <CountAdjustmentPrint
        header={header}
        countedLines={3}
        lines={[
          { name: "Chicharrón", unit: "kg", expected: 3.5, counted: 1.2, difference: -2.3, differenceValue: -55200, reason: "Merma no registrada" },
          { name: "Aceite vegetal", unit: "l", expected: 5, counted: 6, difference: 1, differenceValue: 9500, reason: null },
          { name: "Sal", unit: "kg", expected: 3, counted: 3, difference: 0, differenceValue: 0, reason: null },
        ]}
      />,
    )
    const doc = screen.getByRole("document", { name: "Acta de ajuste" })
    const row = within(doc).getByRole("row", { name: /Chicharrón/ })
    expect(row).toHaveTextContent("3,5 kg")
    expect(row).toHaveTextContent("1,2 kg")
    expect(row).toHaveTextContent("-2,3 kg")
    expect(row).toHaveTextContent(/-\$\s?55\.200/)
    expect(row).toHaveTextContent("Merma no registrada")
    expect(within(doc).queryByRole("row", { name: /Sal/ })).toBeNull()
    expect(within(doc).getByRole("row", { name: /Diferencia valorizada total/ })).toHaveTextContent(/-\$\s?45\.700/)
    expect(doc).toHaveTextContent("Contó: Andrés Gómez · firma")
    expect(doc).toHaveTextContent("Revisó y aprobó: Mariana Restrepo · firma")
  })
})
