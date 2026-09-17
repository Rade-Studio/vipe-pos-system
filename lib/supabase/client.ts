import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/supabase"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Warn (don't throw) at module load if env vars are missing.
// Throwing here breaks `npm run build` during static page prerendering
// (Next.js evaluates modules before the ignoreBuildErrors: true guard applies).
// The app will fail at runtime with a clear error from createClient instead.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[VipePOS] Missing environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. The app will not function without them.",
  )
}

// Allow the client to be created with undefined values here;
// createClient will throw at runtime with a clear message.
export const supabase = createClient<Database>(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
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
