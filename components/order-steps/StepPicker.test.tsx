import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { menuCategory, menuDish } from "@/lib/order-steps/fixtures"

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

describe("StepPicker quick-note chips (T22)", () => {
  const withNotes = [
    menuCategory({
      id: "c-9",
      name: "Carnes",
      dishes: [
        menuDish({ id: "d-9", name: "Churrasco", price: 38000, quickNotes: ["Término medio", "Sin cebolla", "Bien asado"] }),
        menuDish({ id: "d-8", name: "Limonada", price: 5000 }),
      ],
    }),
  ]
  const open = async (dish: RegExp) => {
    const onAdd = vi.fn<(item: StepPickerItem) => (() => void) | void>()
    render(<StepPicker menu={withNotes} onAdd={onAdd} onExit={vi.fn()} />)
    await click(screen.getByRole("button", { name: /Carnes/ }))
    await click(screen.getByRole("button", { name: dish }))
    return onAdd
  }

  it("offers the dish's quick notes as toggles and appends them to the comment with the free note", async () => {
    const onAdd = await open(/^Churrasco,/)
    const group = screen.getByRole("group", { name: "Indicaciones rápidas" })
    const chip = (name: string) => within(group).getByRole("button", { name })
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Término medio",
      "Sin cebolla",
      "Bien asado",
    ])
    await click(chip("Sin cebolla"))
    await click(chip("Término medio"))
    await click(chip("Bien asado"))
    await click(chip("Bien asado"))
    expect(chip("Sin cebolla")).toHaveAttribute("aria-pressed", "true")
    expect(chip("Bien asado")).toHaveAttribute("aria-pressed", "false")
    fireEvent.change(screen.getByLabelText("Nota para cocina (opcional)"), { target: { value: " poca sal " } })
    // The free note stays as typed: the chips do not write into it.
    expect(screen.getByLabelText("Nota para cocina (opcional)")).toHaveValue(" poca sal ")

    await click(screen.getByRole("button", { name: /^Agregar 1 ·/ }))
    expect(onAdd.mock.calls[0][0].comments).toBe("Sin cebolla, Término medio, poca sal")
  })

  it("chips alone make the comment; a dish without quick notes shows no chips", async () => {
    const onAdd = await open(/^Churrasco,/)
    await click(screen.getByRole("button", { name: "Término medio" }))
    await click(screen.getByRole("button", { name: /^Agregar 1 ·/ }))
    expect(onAdd.mock.calls[0][0].comments).toBe("Término medio")

    // Back on Categoría after the add, the chips start off.
    await click(screen.getByRole("button", { name: /Carnes/ }))
    await click(screen.getByRole("button", { name: /^Churrasco,/ }))
    expect(screen.getByRole("button", { name: "Término medio" })).toHaveAttribute("aria-pressed", "false")
    await click(screen.getByRole("button", { name: "Volver al paso anterior" }))
    await click(screen.getByRole("button", { name: /^Limonada,/ }))
    expect(screen.queryByRole("group", { name: "Indicaciones rápidas" })).not.toBeInTheDocument()
  })
})
