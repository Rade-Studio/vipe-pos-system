import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase"
import { log } from "@/lib/log"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Warn (don't throw) at module load if env vars are missing.
// Throwing here breaks `npm run build` during static page prerendering
// (Next.js evaluates modules before the ignoreBuildErrors: true guard applies).
// The app will fail at runtime with a clear error from createClient instead.
if (!supabaseUrl || !supabaseAnonKey) {
  log.warn(
    "[VipePOS] Missing environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. The app will not function without them.",
  )
}

// Inert placeholders when unset (plain-Postgres dev stack, T7): createClient
// throws on an empty URL, which turned every page importing a service into a
// 500. Requests to this host fail quietly; never a real project URL.
export const supabase = createClient<Database>(
  supabaseUrl || "http://unused.invalid",
  supabaseAnonKey || "unused",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
)

export function createSupabaseClient() {
  return supabase
}
