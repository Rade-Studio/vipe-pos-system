/**
 * Auth events of the web shell. The API client is the only producer: a 401
 * whose silent refresh failed emits `signed_out`, and the portal page goes back
 * to the login. Replaces Supabase's `onAuthStateChange`, so token refreshes no
 * longer reach the shell at all (they were what reset an admin's impersonated
 * view).
 */
export type AuthEvent = "signed_out"

type Listener = (event: AuthEvent) => void

const listeners = new Set<Listener>()

/** Subscribe; returns the unsubscribe function. */
export function onAuthEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitAuthEvent(event: AuthEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // One broken listener must not keep the others signed in.
    }
  }
}
