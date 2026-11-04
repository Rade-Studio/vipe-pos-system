/**
 * A non-2xx answer from the API. The API's exception filter always sends
 * `{statusCode, error, message}`; anything else (a proxy error page, a network
 * hiccup turned into HTML) falls back to the HTTP status text.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
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
          return new ApiError(response.status, typeof error === "string" ? error : fallback, text)
        }
      }
    } catch {
      // Not JSON: keep the status text.
    }
    return new ApiError(response.status, fallback, fallback)
  }
}
