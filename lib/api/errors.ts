const INVALID_DATA = "Los datos no son válidos: revisa los valores ingresados."

/**
 * H-023: the API's generic English answers (`apps/api/src/common/error-response.ts`),
 * keyed by SQLSTATE `code` and the exact generic text. Only that pair is translated:
 * a 22023 raised by an RPC, a P0001 or a handler's own message ("Insufficient stock")
 * keeps its words, because callers match them. `body` always keeps the original.
 */
const GENERIC_MESSAGES: Record<string, Record<string, string>> = {
  "23505": { "Conflict with existing data": "Ya existe un registro con esos datos." },
  "42501": { "Permission denied": "No tienes permiso para realizar esta acción." },
  "23514": { "Invalid data": INVALID_DATA },
  "23503": { "Invalid data": INVALID_DATA },
  "22P02": { "Invalid data": INVALID_DATA },
  "22023": { "Invalid data": INVALID_DATA },
  "22001": { "Value too long": "Un texto supera la longitud permitida." },
  "22003": { "Number out of range": "Un número está fuera del rango permitido." },
  P0002: { "Not found": "El registro no existe." },
}
const UNCODED_MESSAGES: Record<string, string> = {
  "Internal server error": "Ocurrió un error en el servidor. Intenta de nuevo.",
  "Invalid credentials": "Email o contraseña incorrectos.",
}

const spanishMessage = (code: string | undefined, message: string): string =>
  (code ? GENERIC_MESSAGES[code]?.[message] : UNCODED_MESSAGES[message]) ?? message

/**
 * A non-2xx answer from the API. The API's exception filter always sends
 * `{statusCode, error, message}`; anything else (a proxy error page, a network
 * hiccup turned into HTML) falls back to the HTTP status text. `body` keeps
 * the whole JSON body, so a caller can read the extra fields some answers
 * carry (409 `shortages`, `prices`, `orderId`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
    readonly body: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = "ApiError"
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const fallback = response.statusText || `HTTP ${response.status}`
    try {
      const body: unknown = await response.clone().json()
      if (body && typeof body === "object") {
        const { error, message } = body as { error?: unknown; message?: unknown }
        const text = Array.isArray(message) ? message.join("; ") : message
        if (typeof text === "string") {
          const { code } = body as { code?: unknown }
          return new ApiError(
            response.status,
            typeof error === "string" ? error : fallback,
            spanishMessage(typeof code === "string" ? code : undefined, text),
            body as Record<string, unknown>,
          )
        }
      }
    } catch {
      // Not JSON: keep the status text.
    }
    return new ApiError(response.status, fallback, fallback)
  }
}

/**
 * The API's own words for a business conflict (409: `La mesa tiene órdenes
 * abiertas`, `Order is paid`, `La mesa no se puede liberar mientras está en
 * cocina`...); anything else
 * (network, 5xx, validation) gets the screen's generic `fallback`.
 */
export function conflictMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.status === 409 ? error.message : fallback
}
