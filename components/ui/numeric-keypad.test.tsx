import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { NumericKeypad } from "./numeric-keypad"

describe("NumericKeypad", () => {
  it("ignores keys typed into another input (H-064)", () => {
    const onValueChange = vi.fn()
    render(
      <>
        <input aria-label="Nota" />
        <textarea aria-label="Motivo" />
        <NumericKeypad value="12" onValueChange={onValueChange} />
      </>,
    )
    const input = screen.getByLabelText("Nota")
    fireEvent.keyDown(input, { key: "5" })
    fireEvent.keyDown(input, { key: "c" })
    fireEvent.keyDown(input, { key: "Backspace" })
    fireEvent.keyDown(screen.getByLabelText("Motivo"), { key: "7" })
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("still accepts physical keys when no input is focused", () => {
    const onValueChange = vi.fn()
    render(<NumericKeypad value="12" onValueChange={onValueChange} />)
    fireEvent.keyDown(window, { key: "5" })
    expect(onValueChange).toHaveBeenLastCalledWith("125")
    fireEvent.keyDown(window, { key: "Backspace" })
    expect(onValueChange).toHaveBeenLastCalledWith("1")
  })

  it("names the icon-only clear and backspace buttons (H-070)", () => {
    const onValueChange = vi.fn()
    render(<NumericKeypad value="12" onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }))
    expect(onValueChange).toHaveBeenLastCalledWith("")
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }))
    expect(onValueChange).toHaveBeenLastCalledWith("1")
  })
})
