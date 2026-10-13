/**
 * `supabase.auth.onAuthStateChange` fires for far more than a real sign-in:
 * every access-token refresh (`TOKEN_REFRESHED`, roughly every 50 minutes
 * plus whatever the client does on focus) and one `INITIAL_SESSION` that
 * duplicates the explicit `getSession()` the shell already did in the same
 * effect.
 *
 * Reloading the profile on those duplicates re-queried `profiles` and reset
 * `selectedProfile` to the real role, which is what wiped an admin's
 * impersonated view. A `SIGNED_IN` re-announced for the user already loaded is
 * the same duplicate hazard (Supabase re-emits it on some clients), so the
 * rule is: reload when the identity actually changed, or on sign-out. Pure
 * predicate so the rule is unit-tested.
 */
export function shouldReloadAuthProfile(
  event: string,
  lastUserId: string | null,
  userId: string | null,
): boolean {
  // Signing out always clears the identity.
  if (event === "SIGNED_OUT") return true
  // Anything else only matters when the identity changed: a new SIGNED_IN, or
  // a different user on any other event. Same user, same profile.
  return userId !== lastUserId
}