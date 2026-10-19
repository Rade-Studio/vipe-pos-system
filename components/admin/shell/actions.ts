import { supabase } from "@/lib/supabase/client"

/** Same sign-out as the shared Header: a hard reload clears stores, queries and realtime subscriptions. */
export async function signOutAndLeave() {
  await supabase.auth.signOut()
  window.location.href = "/portal"
}
