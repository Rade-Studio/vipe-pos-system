import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { menuDish } from "@/lib/order-steps/fixtures"
import { active, happyHour, later, menuEjecutivo, other, promotion, today } from "@/lib/promotions/fixtures"
import { stripState } from "@/lib/promotions/waiter"
import { ComboBuilder } from "./ComboBuilder"
import { PromotionNudge, WindowEndingWarning } from "./OrderPromotions"
import { PromotionStrip } from "./PromotionStrip"
import { PromotionsSheet } from "./PromotionsSheet"

/** S11/S12 pieces of design/promociones/04-mesero.html. */

describe("PromotionStrip (S11)", () => {
  it("announces the active promotion with its sentence and minutes left", () => {
    render(<PromotionStrip state={stripState(today({ active: [active(happyHour, "19:00", 50)] }))} />)
    const strip = screen.getByRole("status")
    expect(strip).toHaveAttribute("aria-live", "polite")
    expect(strip).toHaveAttribute("data-state", "active")
    expect(strip).toHaveTextContent("Happy hour 2x1 en cócteles")
    expect(strip).toHaveTextContent("En cócteles, de 5 a 7, pide 2 y paga 1; se pueden mezclar.")
    expect(strip).toHaveTextContent("quedan 50 min")
  })

  it("turns yellow in the last 10 minutes", () => {
    render(<PromotionStrip state={stripState(today({ active: [active(happyHour, "19:00", 8)] }))} />)
    const strip = screen.getByRole("status")
    expect(strip).toHaveAttribute("data-state", "ending")
    expect(strip.className).toContain("bg-status-warning-bg")
    expect(strip).toHaveTextContent("Termina a las 19:00. Envía el pedido antes para que se aplique.")
    expect(strip).toHaveTextContent("quedan 8 min")
  })

  it("says Sin promociones en este momento without one", () => {
    render(<PromotionStrip state={stripState(today())} />)
    expect(screen.getByRole("status")).toHaveTextContent("Sin promociones en este momento")
  })
})

describe("PromotionsSheet (S11)", () => {
  const data = today({
    localTime: "18:10",
    active: [active(happyHour, "19:00", 50)],
    laterToday: [later(menuEjecutivo, "20:00")],
    others: [other(promotion({ id: "p-mar", name: "Martes de hamburguesa 20%", daysOfWeek: [2], sentence: "Los martes, 20% en todas las hamburguesas." }), "other_day")],
  })

  it("opens Promociones de hoy with Ahora, Más tarde hoy and No aplican ahora en el salón, each with Al cliente", async () => {
    render(<PromotionsSheet today={data} />)
    const button = screen.getByRole("button", { name: "Promociones: 1 activa ahora" })
    expect(button).toHaveAttribute("aria-haspopup", "dialog")
    await act(async () => {
      fireEvent.click(button)
    })
    const sheet = screen.getByRole("dialog", { name: "Promociones de hoy" })
    const now = within(sheet).getByRole("region", { name: "Ahora · 18:10" })
    expect(now).toHaveTextContent("Happy hour 2x1 en cócteles")
    expect(now).toHaveTextContent("Hasta 19:00")
    expect(now).toHaveTextContent("Al cliente: En cócteles, de 5 a 7, pide 2 y paga 1; se pueden mezclar.")
    expect(now).toHaveTextContent("Lun–Vie · 17:00–19:00 · Salón")
    const laterToday = within(sheet).getByRole("region", { name: "Más tarde hoy" })
    expect(laterToday).toHaveTextContent("Menú ejecutivo")
    expect(laterToday).toHaveTextContent("Desde 20:00")
    const others = within(sheet).getByRole("region", { name: "No aplican ahora en el salón" })
    expect(others).toHaveTextContent("Martes de hamburguesa 20%")
    expect(others).toHaveTextContent("Al cliente: Los martes, 20% en todas las hamburguesas.")
    // The focus moved into the sheet.
    expect(sheet.contains(document.activeElement)).toBe(true)
  })

  it("says Ninguna en este momento with nothing active", async () => {
    render(<PromotionsSheet today={today()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Promociones: 0 activas ahora" }))
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Ninguna en este momento.")
  })
})

describe("ComboBuilder (S12)", () => {
  const dishes = new Map(
    [
      menuDish({ id: "d-ajiaco", name: "Ajiaco del día", price: 9000 }),
      menuDish({ id: "d-bandeja", name: "Bandeja ejecutiva", price: 17000 }),
      menuDish({ id: "d-pollo", name: "Pollo a la plancha", price: 17000 }),
      menuDish({ id: "d-mora", name: "Jugo de mora", price: 7000 }),
    ].map((dish) => [dish.id, dish]),
  )

  it("asks 1 of each group with the loose price, then shows the saving and adds the combo", () => {
    const onAdd = vi.fn()
    render(<ComboBuilder promotion={menuEjecutivo} dishes={dishes} endsAt="15:00" onAdd={onAdd} />)
    expect(screen.getByRole("heading", { name: "Menú ejecutivo" })).toHaveFocus()
    expect(screen.getByText("Elige 1 de cada grupo · hasta las 15:00")).toBeInTheDocument()
    const add = screen.getByRole("button", { name: /^Agregar menú · \$\s?24\.000$/ })
    expect(add).toBeDisabled()
    expect(screen.getByText("Faltan 3 por elegir")).toBeInTheDocument()
    expect(within(screen.getByRole("group", { name: "Sopa" })).getByRole("button", { name: /Ajiaco del día/ })).toHaveTextContent(/Suelto \$\s?9\.000/)

    fireEvent.click(screen.getByRole("button", { name: /Ajiaco del día/ }))
    fireEvent.click(screen.getByRole("button", { name: /Bandeja ejecutiva/ }))
    expect(add).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Jugo de mora/ }))
    expect(screen.getByRole("button", { name: /Jugo de mora/ })).toHaveAttribute("aria-pressed", "true")
    expect(add).toBeEnabled()
    expect(screen.getByText(/Por separado \$\s?33\.000/).parentElement).toHaveTextContent(/Por separado \$\s?33\.000 · ahorra \$\s?9\.000/)

    fireEvent.click(add)
    expect(onAdd).toHaveBeenCalledWith({
      promotionId: "p-ejec",
      comboPrice: 24000,
      listPrice: 33000,
      choices: [
        { groupId: "g-sopa", dishId: "d-ajiaco", name: "Ajiaco del día", price: 9000 },
        { groupId: "g-principio", dishId: "d-bandeja", name: "Bandeja ejecutiva", price: 17000 },
        { groupId: "g-bebida", dishId: "d-mora", name: "Jugo de mora", price: 7000 },
      ],
    })
  })
})

describe("order nudges (S11)", () => {
  it("quick-adds a dish of the promotion from the nudge", () => {
    const onQuickAdd = vi.fn()
    const add = { dish: menuDish({ id: "d-m", name: "Mojito" }), category: {} as never }
    render(<PromotionNudge message="Falta 1 unidad para otro 2x1." adds={[add]} onQuickAdd={onQuickAdd} />)
    expect(screen.getByRole("status")).toHaveTextContent("Falta 1 unidad para otro 2x1.")
    fireEvent.click(screen.getByRole("button", { name: "+ Mojito" }))
    expect(onQuickAdd).toHaveBeenCalledWith(add)
  })

  it("warns to send before the window ends", () => {
    render(<WindowEndingWarning warning={{ promotionId: "p-hh", endsAt: "19:00", minutesLeft: 8 }} />)
    expect(screen.getByRole("status")).toHaveTextContent("Envía antes de las 19:00.")
    expect(screen.getByRole("status")).toHaveTextContent("Quedan 8 min")
  })
})
