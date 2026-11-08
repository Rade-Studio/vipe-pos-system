import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"
import { modifierGroup } from "@/lib/modifiers/fixtures"
import { formatCurrency } from "@/utils/helpers"

const toastFn = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastFn }) }))

import { StepPicker, type StepPickerItem } from "./StepPicker"

const menu = [
  menuCategory({
    id: "c-1",
    name: "Platos fuertes",
    color: "orange",
    subcategories: [
      { id: "s-1", name: "Carnes" },
      { id: "s-2", name: "Típicos" },
    ],
    dishes: [
      menuDish({ id: "d-1", name: "Bandeja paisa", price: 32000, subcategoryId: "s-1" }),
      menuDish({ id: "d-2", name: "Ajiaco", price: 28000, subcategoryId: "s-2", available: false }),
    ],
  }),
  menuCategory({
    id: "c-2",
    name: "Postres",
    dishes: [menuDish({ id: "d-3", name: "Arroz con leche", price: 7000, allowComments: false })],
  }),
]

function renderPicker(onAdd = vi.fn<(item: StepPickerItem) => (() => void) | void>(), onExit = vi.fn()) {
  render(
    <StepPicker
      menu={menu}
      onAdd={onAdd}
      onExit={onExit}
      exitLabel="Mapa"
      header={<b>Mesa 4</b>}
      summary={<span>Resumen</span>}
      primaryAction={<button type="button">Enviar a cocina (0)</button>}
    />,
  )
  return { onAdd, onExit }
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element)
  })
}

const heading = () => screen.getByRole("heading", { level: 2 })

beforeEach(() => toastFn.mockReset())

describe("StepPicker (T10, S5)", () => {
  it("renders the categories of the tree as big tiles, in menu order", () => {
    renderPicker()
    expect(heading()).toHaveTextContent("¿Qué categoría?")
    const tiles = screen.getAllByRole("button", { name: /subcategorías|directo/ })
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      expect.stringContaining("Platos fuertes"),
      expect.stringContaining("Postres"),
    ])
    expect(screen.getByRole("button", { name: /Platos fuertes/ })).toHaveTextContent("2 subcategorías")
    expect(screen.getByRole("button", { name: /Postres/ })).toHaveTextContent("1 plato · directo")
    expect(screen.getByText("Resumen")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar a cocina (0)" })).toBeInTheDocument()
  })

  it("goes Categoría → Subcategoría → Plato → Agregar and adds the quantity and note", async () => {
    const { onAdd } = renderPicker()
    await click(screen.getByRole("button", { name: /Platos fuertes/ }))
    expect(heading()).toHaveTextContent("Platos fuertes")
    await click(screen.getByRole("button", { name: /Carnes/ }))
    expect(heading()).toHaveTextContent("Carnes")
    await click(screen.getByRole("button", { name: /Bandeja paisa/ }))
    expect(heading()).toHaveTextContent("Bandeja paisa")

    await click(screen.getByRole("button", { name: "Sumar uno" }))
    fireEvent.change(screen.getByLabelText("Nota para cocina (opcional)"), { target: { value: " término medio " } })
    await click(screen.getByRole("button", { name: /^Agregar 2 ·/ }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    const item = onAdd.mock.calls[0][0]
    expect(item.dish.id).toBe("d-1")
    expect(item.quantity).toBe(2)
    expect(item.comments).toBe("término medio")
    // Back to Categoría with the toast.
    expect(heading()).toHaveTextContent("¿Qué categoría?")
    expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "✓ 2× Bandeja paisa agregada" }))
  })

  it("offers Deshacer when the consumer can undo the add", async () => {
    const undo = vi.fn()
    renderPicker(vi.fn<(item: StepPickerItem) => (() => void) | void>(() => undo))
    await click(screen.getByRole("button", { name: /Postres/ }))
    await click(screen.getByRole("button", { name: /Arroz con leche/ }))
    await click(screen.getByRole("button", { name: /^Agregar 1 ·/ }))

    const { action } = toastFn.mock.calls[0][0]
    expect(action.props.children).toBe("Deshacer")
    action.props.onClick()
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it("skips Subcategoría for a category without subcategories and still offers the note when comments are off", async () => {
    renderPicker()
    await click(screen.getByRole("button", { name: /Postres/ }))
    expect(heading()).toHaveTextContent("Postres")
    expect(screen.getByText("Postres no tiene subcategorías: saltaste directo a los platos.")).toBeInTheDocument()
    const crumbs = screen.getByRole("navigation", { name: "Pasos para agregar" })
    expect(within(crumbs).getByRole("button", { name: /Paso 2, Subcategoría: Sin subcategoría/ })).toBeDisabled()

    await click(screen.getByRole("button", { name: /Arroz con leche/ }))
    expect(screen.getByLabelText("Nota para cocina (opcional)")).toBeInTheDocument()
  })

  it("leaves an Agotado dish in place and only toasts", async () => {
    const { onAdd } = renderPicker()
    await click(screen.getByRole("button", { name: /Platos fuertes/ }))
    await click(screen.getByRole("button", { name: /Típicos/ }))
    const soldOut = screen.getByRole("button", { name: /Ajiaco, .*agotado/ })
    expect(soldOut).toHaveAttribute("aria-disabled", "true")
    expect(soldOut).toHaveTextContent("Agotado")

    await click(soldOut)
    expect(heading()).toHaveTextContent("Típicos")
    expect(onAdd).not.toHaveBeenCalled()
    expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Agotado: Ajiaco · ofrece otra opción" }))
  })

  it("goes back through the crumbs and the back button, and exits from Categoría", async () => {
    const { onExit } = renderPicker()
    await click(screen.getByRole("button", { name: /Platos fuertes/ }))
    await click(screen.getByRole("button", { name: /Carnes/ }))
    await click(screen.getByRole("button", { name: /Bandeja paisa/ }))

    await click(screen.getByRole("button", { name: /Paso 2, Subcategoría: Carnes. Volver a este paso/ }))
    expect(heading()).toHaveTextContent("Platos fuertes")
    expect(screen.getByRole("button", { name: /Paso 2, Subcategoría/ })).toHaveAttribute("aria-current", "step")

    await click(screen.getByRole("button", { name: "Volver al paso anterior" }))
    expect(heading()).toHaveTextContent("¿Qué categoría?")
    expect(onExit).not.toHaveBeenCalled()

    await click(screen.getByRole("button", { name: "Mapa" }))
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it("shows the sticky Agregar n on the Agregar step instead of the consumer's action", async () => {
    renderPicker()
    await click(screen.getByRole("button", { name: /Postres/ }))
    await click(screen.getByRole("button", { name: /Arroz con leche/ }))
    await click(screen.getByRole("button", { name: "Sumar uno" }))
    expect(screen.getByRole("button", { name: "Agregar 2 Arroz con leche al pedido" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Enviar a cocina (0)" })).not.toBeInTheDocument()
  })

  it("says so when the menu is empty or failed", () => {
    const { rerender } = render(<StepPicker menu={[]} onAdd={vi.fn()} onExit={vi.fn()} />)
    expect(screen.getByText("No hay categorías en el menú.")).toBeInTheDocument()
    const onRetry = vi.fn()
    rerender(<StepPicker menu={undefined} isError onRetry={onRetry} onAdd={vi.fn()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe("StepPicker modifier sheet (F7)", () => {
  const termino = modifierGroup({ id: "g-t", name: "Término de la carne", minSelect: 1, maxSelect: 1, options: [["o-azul", "Azul", 0], ["o-medio", "Medio", 0]] })
  const adic = modifierGroup({
    id: "g-a",
    name: "Adiciones",
    maxSelect: 3,
    options: [["o-ched", "Queso cheddar", 3000], ["o-toc", "Tocineta", 4000], ["o-hue", "Huevo", 2500], ["o-agu", "Aguacate", 3500]],
  })
  const withGroups = [
    menuCategory({
      id: "c-9",
      name: "Hamburguesas",
      dishes: [
        menuDish({ id: "d-9", name: "Hamburguesa artesanal", price: 22000, modifierGroups: [termino, adic] }),
        menuDish({ id: "d-8", name: "Limonada", price: 5000 }),
      ],
    }),
  ]
  const open = async (dish: RegExp) => {
    const onAdd = vi.fn<(item: StepPickerItem) => (() => void) | void>()
    render(<StepPicker menu={withGroups} onAdd={onAdd} onExit={vi.fn()} />)
    await click(screen.getByRole("button", { name: /Hamburguesas/ }))
    await click(screen.getByRole("button", { name: dish }))
    return onAdd
  }
  const sheet = () => screen.getByRole("dialog", { name: "Hamburguesa artesanal" })
  const option = (name: string) => within(sheet()).getByRole(name === "Medio" || name === "Azul" ? "radio" : "checkbox", { name: new RegExp(`^${name}`) })
  const addButton = () => within(sheet()).getByRole("button", { name: /^Agregar ·/ })

  it("opens the sheet with the groups in order; the required one blocks the add and names what is missing", async () => {
    await open(/^Hamburguesa artesanal,/)
    expect(within(sheet()).getAllByRole("group").length).toBeGreaterThan(0)
    expect(sheet()).toHaveTextContent(/Término de la carne.*Obligatorio · elige 1.*Falta elegir.*Adiciones.*Opcional · hasta 3.*0 de 3/)
    expect(addButton()).toBeDisabled()
    expect(within(sheet()).getByText("Falta: Término de la carne")).toBeInTheDocument()
    await click(option("Medio"))
    expect(addButton()).toBeEnabled()
    expect(within(sheet()).queryByText(/^Falta:/)).not.toBeInTheDocument()
    expect(option("Medio")).toHaveClass("min-h-11")
  })

  it("prices the line live and adds dish, quantity, note, options and unit price", async () => {
    const onAdd = await open(/^Hamburguesa artesanal,/)
    await click(option("Medio"))
    await click(option("Queso cheddar"))
    await click(option("Tocineta"))
    const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ")
    expect(flat(sheet().textContent)).toContain(flat(`Hamburguesa ${formatCurrency(22000)} + ${formatCurrency(7000)} = ${formatCurrency(29000)} c/u`))
    expect(within(sheet()).getByText("2 de 3")).toBeInTheDocument()
    await click(within(sheet()).getByRole("button", { name: "Sumar uno" }))
    expect(flat(addButton().textContent)).toContain(flat(formatCurrency(58000)))
    fireEvent.change(within(sheet()).getByLabelText("Nota para cocina (opcional)"), { target: { value: " pan sin tostar " } })
    await click(addButton())
    const item = onAdd.mock.calls[0][0]
    expect(item).toMatchObject({ quantity: 2, comments: "pan sin tostar", unitPrice: 29000 })
    expect(item.dish.id).toBe("d-9")
    expect(item.modifiers?.map((m) => m.optionId)).toEqual(["o-medio", "o-ched", "o-toc"])
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(heading()).toHaveTextContent("¿Qué categoría?")
  })

  it("enforces the max: the 4th addition is refused with a toast", async () => {
    await open(/^Hamburguesa artesanal,/)
    for (const name of ["Queso cheddar", "Tocineta", "Huevo"]) await click(option(name))
    expect(option("Aguacate")).toHaveAttribute("aria-disabled", "true")
    await click(option("Aguacate"))
    expect(option("Aguacate")).toHaveAttribute("aria-checked", "false")
    expect(toastFn).toHaveBeenCalledWith({ title: "Máximo 3 en Adiciones" })
    expect(within(sheet()).getByText("3 de 3")).toBeInTheDocument()
  })

  it("a dish without groups goes to step 4 as before and adds with only the free note", async () => {
    const onAdd = await open(/^Limonada,/)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(heading()).toHaveTextContent("Limonada")
    expect(screen.queryByText("Indicaciones rápidas")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nota para cocina (opcional)"), { target: { value: " sin hielo " } })
    await click(screen.getByRole("button", { name: /^Agregar 1 ·/ }))
    expect(onAdd.mock.calls[0][0]).toEqual({ dish: withGroups[0].dishes[1], category: withGroups[0], quantity: 1, comments: "sin hielo" })
  })
})
