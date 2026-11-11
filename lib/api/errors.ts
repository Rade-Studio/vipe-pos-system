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
          return new ApiError(
            response.status,
            typeof error === "string" ? error : fallback,
            text,
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
