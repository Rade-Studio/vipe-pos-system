import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/errors"
import { arrivalLabel, isFreeTable, reservationLine, reserveErrorMessage, validateReservation } from "./reservation"

describe("reservation helpers (reservas-mesas T2, S1, S2, L4)", () => {
  it("formats the arrival as es-CO 12-hour time", () => {
    const at = new Date()
    at.setHours(20, 30, 0, 0)
    expect(arrivalLabel(at.toISOString())).toBe("8:30 p. m.")
  })

  it("builds the reserved table line with and without arrival", () => {
    const at = new Date()
    at.setHours(20, 30, 0, 0)
    expect(reservationLine({ status: "reserved", reservationName: "Familia López", reservationArrivalAt: at.toISOString() })).toBe(
      "Reserva: Familia López · llega 8:30 p. m.",
    )
    expect(reservationLine({ status: "reserved", reservationName: "Ana" })).toBe("Reserva: Ana")
    expect(reservationLine({ status: "occupied", reservationName: "Ana" })).toBeNull()
  })

  it("a free table is available with no open order", () => {
    expect(isFreeTable({ status: "available" }, false)).toBe(true)
    expect(isFreeTable({ status: "available" }, true)).toBe(false)
    expect(isFreeTable({ status: "occupied" }, false)).toBe(false)
    expect(isFreeTable({ status: "reserved" }, false)).toBe(false)
  })

  it("validates the name (required, trimmed, 1..80)", () => {
    expect(validateReservation({ name: "   ", time: "" })).toEqual({ ok: false, field: "name", message: "Escribe a nombre de quién" })
    expect(validateReservation({ name: "x".repeat(81), time: "" })).toEqual({ ok: false, field: "name", message: "Máximo 80 caracteres" })
    expect(validateReservation({ name: "  Familia López ", time: "" })).toEqual({ ok: true, body: { name: "Familia López" } })
    expect(validateReservation({ name: "x".repeat(80), time: "" })).toMatchObject({ ok: true })
  })

  it("turns the time into today's ISO instant; earlier than 5 min ago has passed", () => {
    // Noon today: every case below stays on the same calendar day.
    const now = new Date()
    now.setHours(12, 0, 0, 0)
    const at = (h: number, m: number) => {
      const d = new Date(now)
      d.setHours(h, m, 0, 0)
      return d.toISOString()
    }
    expect(validateReservation({ name: "Ana", time: "20:30" }, now)).toEqual({ ok: true, body: { name: "Ana", arrivalAt: at(20, 30) } })
    expect(validateReservation({ name: "Ana", time: "11:50" }, now)).toEqual({ ok: false, field: "time", message: "La hora ya pasó" })
    expect(validateReservation({ name: "Ana", time: "11:56" }, now)).toEqual({ ok: true, body: { name: "Ana", arrivalAt: at(11, 56) } })
  })

  it("speaks the API errors in the sheet's words", () => {
    const notFree = new ApiError(409, "Conflict", "Table is not available", { code: "table_not_available" })
    expect(reserveErrorMessage(notFree)).toBe("Esta mesa ya no está libre")
    const past = new ApiError(422, "Unprocessable Entity", "Arrival time is in the past", { code: "arrival_in_past" })
    expect(reserveErrorMessage(past)).toBe("La hora ya pasó")
    expect(reserveErrorMessage(new Error("network"))).toBe("No se pudo reservar la mesa. Intente nuevamente.")
  })
})
