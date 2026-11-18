import { describe, expect, it } from "vitest"
import { ApiError } from "./errors"

/** H-023: the API's generic database errors reach the user in Spanish. */

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const fromBody = (status: number, body: Record<string, unknown>) => ApiError.fromResponse(response(status, body))

describe("ApiError Spanish messages (H-023)", () => {
  it.each([
    [409, "23505", "Conflict with existing data", "Ya existe un registro con esos datos."],
    [403, "42501", "Permission denied", "No tienes permiso para realizar esta acción."],
    [422, "23514", "Invalid data", "Los datos no son válidos: revisa los valores ingresados."],
    [422, "23503", "Invalid data", "Los datos no son válidos: revisa los valores ingresados."],
    [422, "22P02", "Invalid data", "Los datos no son válidos: revisa los valores ingresados."],
    [422, "22023", "Invalid data", "Los datos no son válidos: revisa los valores ingresados."],
    [422, "22001", "Value too long", "Un texto supera la longitud permitida."],
    [422, "22003", "Number out of range", "Un número está fuera del rango permitido."],
    [404, "P0002", "Not found", "El registro no existe."],
  ])("maps %i %s to Spanish and keeps the code", async (status, code, message, spanish) => {
    const error = await fromBody(status, { statusCode: status, error: "x", message, code })
    expect(error).toMatchObject({ status, message: spanish })
    expect(error.body).toMatchObject({ code, message })
  })

  it("maps the generic 500", async () => {
    const error = await fromBody(500, { statusCode: 500, error: "Internal Server Error", message: "Internal server error" })
    expect(error.message).toBe("Ocurrió un error en el servidor. Intenta de nuevo.")
  })

  it("keeps the messages the RPCs and handlers wrote (previous behavior)", async () => {
    const raised = await fromBody(422, { statusCode: 422, error: "x", message: "fn_x: qty appears twice", code: "22023" })
    expect(raised.message).toBe("fn_x: qty appears twice")
    const business = await fromBody(409, { statusCode: 409, error: "Conflict", message: "Insufficient stock", shortages: [] })
    expect(business.message).toBe("Insufficient stock")
    const rpc = await fromBody(422, { statusCode: 422, error: "x", message: "La caja está cerrada", code: "P0001" })
    expect(rpc.message).toBe("La caja está cerrada")
  })
})

describe("ApiError login message (H-023, H-103)", () => {
  it("shows the generic login failure in Spanish", async () => {
    const error = await fromBody(401, { statusCode: 401, error: "Unauthorized", message: "Invalid credentials" })
    expect(error.message).toBe("Email o contraseña incorrectos.")
  })
})
