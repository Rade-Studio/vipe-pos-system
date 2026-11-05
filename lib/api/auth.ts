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
