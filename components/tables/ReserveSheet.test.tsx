import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"

const env = vi.hoisted(() => ({ reserveTable: vi.fn(), toastFn: vi.fn() }))
vi.mock("@/lib/api/tables", () => ({ reserveTable: (...args: unknown[]) => env.reserveTable(...args) }))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: env.toastFn }) }))

import { ReserveSheet } from "./ReserveSheet"

const dto = { id: "t-7", number: 7, status: "reserved", reservationName: "Familia López" }

beforeEach(() => {
  env.reserveTable.mockReset().mockResolvedValue(dto)
  env.toastFn.mockReset()
})

const renderSheet = () => {
  const onClose = vi.fn()
  const onReserved = vi.fn()
  render(<ReserveSheet table={{ id: "t-7", number: 7 }} onClose={onClose} onReserved={onReserved} />)
  return { onClose, onReserved }
}
const nameField = () => screen.getByLabelText("¿A nombre de quién?")
const submit = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Reservar" }))
  })
}

describe("ReserveSheet (reservas-mesas T2, S2, S3)", () => {
  it("asks the name (autofocus) and an optional arrival time, 44 px controls", () => {
    renderSheet()
    expect(screen.getByRole("heading", { name: "Reservar mesa 7" })).toBeInTheDocument()
    expect(nameField()).toHaveFocus()
    expect(nameField()).toHaveAttribute("maxLength", "80")
    expect(screen.getByLabelText(/Hora de llegada/)).toHaveAttribute("type", "time")
    for (const name of ["Reservar", "Cancelar"]) expect(screen.getByRole("button", { name })).toHaveClass("min-h-11")
    expect(nameField()).toHaveClass("min-h-11")
  })

  it("refuses an empty name without calling the API", async () => {
    const { onReserved } = renderSheet()
    fireEvent.change(nameField(), { target: { value: "   " } })
    await submit()
    expect(screen.getByText("Escribe a nombre de quién")).toBeInTheDocument()
    expect(nameField()).toHaveAttribute("aria-invalid", "true")
    expect(env.reserveTable).not.toHaveBeenCalled()
    expect(onReserved).not.toHaveBeenCalled()
  })

  it("refuses a time that already passed", async () => {
    renderSheet()
    const past = new Date(Date.now() - 30 * 60_000)
    // Just after midnight "30 min ago" is yesterday's time, later than now: skip.
    if (past.getDate() !== new Date().getDate()) return
    const hhmm = `${String(past.getHours()).padStart(2, "0")}:${String(past.getMinutes()).padStart(2, "0")}`
    fireEvent.change(nameField(), { target: { value: "Ana" } })
    fireEvent.change(screen.getByLabelText(/Hora de llegada/), { target: { value: hhmm } })
    await submit()
    expect(screen.getByText("La hora ya pasó")).toBeInTheDocument()
    expect(env.reserveTable).not.toHaveBeenCalled()
  })

  it("sends the trimmed name (no arrival) and hands back the table", async () => {
    const { onReserved, onClose } = renderSheet()
    fireEvent.change(nameField(), { target: { value: "  Familia López " } })
    await submit()
    expect(env.reserveTable).toHaveBeenCalledWith("t-7", { name: "Familia López" })
    expect(onReserved).toHaveBeenCalledWith(dto)
    expect(onClose).not.toHaveBeenCalled()
  })

  it("409 table_not_available says the table is no longer free", async () => {
    env.reserveTable.mockRejectedValue(new ApiError(409, "Conflict", "Table is not available", { code: "table_not_available" }))
    const { onReserved } = renderSheet()
    fireEvent.change(nameField(), { target: { value: "Ana" } })
    await submit()
    expect(env.toastFn).toHaveBeenCalledWith(expect.objectContaining({ description: "Esta mesa ya no está libre", variant: "destructive" }))
    expect(onReserved).not.toHaveBeenCalled()
  })

  it("Cancelar closes without reserving", async () => {
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(onClose).toHaveBeenCalled()
    expect(env.reserveTable).not.toHaveBeenCalled()
  })
})
