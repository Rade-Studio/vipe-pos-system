import { toast } from "@/components/ui/use-toast"
import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import type { Profile, ProfileRole } from "@/types"

export type Session = components["schemas"]["SessionResponse"]

/** Store shape of the session profile; `useProfileStore` keeps its shape. */
export function profileFromSession(session: Session): Profile {
  return {
    id: session.profile.id,
    name: session.profile.name,
    full_name: session.profile.name,
    role: session.profile.role as ProfileRole,
    restaurantId: session.profile.restaurantId,
  }
}

/** `POST /api/auth/login`: the API sets the cookies and returns the session. */
export async function login(email: string, password: string): Promise<Session> {
  const { data } = await api.POST("/api/auth/login", { body: { email, password } })
  if (!data) throw new ApiError(500, "Internal Server Error", "Empty login response")
  return data
}

/** The current session, or null when the browser has none (401). */
export async function fetchSession(): Promise<Session | null> {
  try {
    const { data } = await api.GET("/api/auth/me")
    return data ?? null
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null
    throw error
  }
}

/**
 * Revoke the API session and leave with a hard reload (clears stores, queries
 * and realtime subscriptions). When the logout request fails the httpOnly
 * cookies are still alive, so the user stays and sees why.
 */
export async function signOutAndReload(): Promise<void> {
  try {
    await api.POST("/api/auth/logout")
  } catch (error) {
    toast({
      title: "Error al cerrar sesión",
      description: error instanceof Error ? error.message : "Intenta nuevamente",
      variant: "destructive",
    })
    return
  }
  window.location.href = "/portal"
}

/*
 * Shared order-taking terminal (F2). A terminal session is opened by an admin
 * or cashier and reaches only the order-taking routes; each order write on it
 * carries the acting claim of the staff member who identified with their PIN.
 */

export type IdentifyResponse = components["schemas"]["IdentifyResponse"]
export type AuthorizeRequest = components["schemas"]["AuthorizeRequest"]
export type AuthorizeResponse = components["schemas"]["AuthorizeResponse"]
export type SupervisorAction = AuthorizeRequest["action"]

/** Header of the acting claim on a terminal's order writes. */
export const ACTING_HEADER = "X-Vipe-Acting"

/** `POST /api/auth/terminal/login`: the API sets the cookies of a terminal session. */
export async function terminalLogin(email: string, password: string): Promise<Session> {
  const { data } = await api.POST("/api/auth/terminal/login", { body: { email, password } })
  if (!data) throw new ApiError(500, "Internal Server Error", "Empty login response")
  return data
}

/** Terminal: the picked staff member enters their PIN; the claim lasts 5 minutes. */
export async function identifyStaff(profileId: string, pin: string): Promise<IdentifyResponse> {
  const { data } = await api.POST("/api/auth/identify", { body: { profileId, pin } })
  if (!data) throw new ApiError(500, "Internal Server Error", "Empty identify response")
  return data
}

/** Headers for an order write made on a terminal by the identified staff member. */
export function actingHeaders(token: string): Record<string, string> {
  return { [ACTING_HEADER]: token }
}

/** The caller changes their own PIN with the current one. */
export async function changeOwnPin(currentPin: string, pin: string): Promise<void> {
  await api.PUT("/api/auth/pin", { body: { currentPin, pin } })
}

/** A supervisor (admin or cashier) PIN: a single-use authorization for one action, valid 2 minutes. */
export async function authorizeSupervisor(input: AuthorizeRequest): Promise<AuthorizeResponse> {
  const { data } = await api.POST("/api/auth/authorize", { body: input })
  if (!data) throw new ApiError(500, "Internal Server Error", "Empty authorize response")
  return data
}

export type PinFailureKind = "wrong" | "locked" | "invalid" | "acting-required" | "unknown"

/** A failed PIN call as a kind and the server's Spanish text (the screens show it verbatim). */
export function pinFailureOf(error: unknown): { kind: PinFailureKind; message: string } {
  if (error instanceof ApiError) {
    const code = error.body.code
    if (code === "pin_invalid") return { kind: "wrong", message: error.message }
    if (code === "pin_locked" || error.status === 429) return { kind: "locked", message: error.message }
    if (code === "acting_required") return { kind: "acting-required", message: error.message }
    if (error.status === 422) return { kind: "invalid", message: error.message }
  }
  return { kind: "unknown", message: "No se pudo verificar el PIN. Inténtalo de nuevo." }
}
