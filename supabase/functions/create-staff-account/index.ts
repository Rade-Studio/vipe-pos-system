// Deno entry point (Supabase Edge Runtime). Logic lives in handler.ts.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createHandler, mapCreateUserError } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

Deno.serve(
  createHandler({
    async getCaller(jwt) {
      const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error } = await authClient.auth.getUser(jwt)
      return error || !data.user ? null : { authUserId: data.user.id }
    },
    async getCallerProfile(authUserId) {
      const { data } = await admin
        .from('profiles')
        .select('role, active, restaurant_id')
        .eq('auth_user_id', authUserId)
        .maybeSingle()
      return data ? { role: data.role, active: data.active === true, restaurantId: data.restaurant_id } : null
    },
    async createUser(params) {
      const { data, error } = await admin.auth.admin.createUser(params)
      if (error || !data.user) {
        console.error('createUser failed', error?.code, error?.message)
        return { ok: false, reason: mapCreateUserError(error?.code) }
      }
      return { ok: true, userId: data.user.id }
    },
    async applyProfile({ authUserId, role, restaurantId, fullName }) {
      const { data, error } = await admin
        .from('profiles')
        .update({ role, restaurant_id: restaurantId, full_name: fullName, updated_at: new Date().toISOString() })
        .eq('auth_user_id', authUserId)
        .select('id')
      if (error) console.error('applyProfile failed', error.code, error.message)
      return !error && (data?.length ?? 0) === 1
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) console.error('deleteUser rollback failed', error.code, error.message)
    },
    async activateUser(userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
      if (error) console.error('activateUser failed', error.code, error.message)
      return !error
    },
    async readProfile(authUserId) {
      const { data } = await admin
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('auth_user_id', authUserId)
        .maybeSingle()
      return data ?? null
    },
  }),
)
