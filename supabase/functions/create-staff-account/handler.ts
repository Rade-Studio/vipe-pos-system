// Runtime-agnostic request handler for create-staff-account. All I/O is injected
// so it can run under Deno (index.ts) and under Vitest.

import { parseCreateStaffInput } from './validate.ts'

export interface CallerProfile {
  role: string
  active: boolean
  restaurantId: string
}

export interface CreateUserParams {
  email: string
  password: string
  email_confirm: true
  /** Banned until fully provisioned; lifted by activateUser. */
  ban_duration: string
  app_metadata: { role: string; restaurant_id: string }
  user_metadata: { full_name: string }
}

export type CreateUserFailureReason = 'duplicate' | 'weak_password' | 'unknown'

export type CreateUserResult = { ok: true; userId: string } | { ok: false; reason: CreateUserFailureReason }

/** Maps a GoTrue admin error code to a failure reason (status 422 alone is ambiguous). */
export function mapCreateUserError(code: string | undefined): CreateUserFailureReason {
  if (code === 'email_exists' || code === 'user_already_exists') return 'duplicate'
  if (code === 'weak_password') return 'weak_password'
  return 'unknown'
}

export interface ProfileRow {
  id: string
  full_name: string
  email: string | null
  role: string
}

export interface ApplyProfileParams {
  authUserId: string
  role: string
  restaurantId: string
  fullName: string
}

export interface HandlerDeps {
  getCaller: (jwt: string) => Promise<{ authUserId: string } | null>
  getCallerProfile: (authUserId: string) => Promise<CallerProfile | null>
  createUser: (params: CreateUserParams) => Promise<CreateUserResult>
  /** Sets role/tenant/name on the trigger-created profile. Returns false if no row was updated. */
  applyProfile: (params: ApplyProfileParams) => Promise<boolean>
  /** Best-effort rollback of the auth user. */
  deleteUser: (userId: string) => Promise<void>
  /** Lifts the provisioning ban. Returns false on error. */
  activateUser: (userId: string) => Promise<boolean>
  readProfile: (authUserId: string) => Promise<ProfileRow | null>
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

const GENERIC_ERROR = 'No se pudo crear la cuenta. Inténtalo de nuevo.'

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handle(deps, req)
    } catch (err) {
      console.error('create-staff-account unexpected error', err instanceof Error ? err.message : 'unknown')
      return json(500, { error: GENERIC_ERROR })
    }
  }
}

async function rollback(deps: HandlerDeps, userId: string, step: string): Promise<Response> {
  console.error(`create-staff-account failed at ${step}; rolling back`)
  try {
    await deps.deleteUser(userId)
  } catch {
    console.error('create-staff-account rollback failed; user remains banned')
  }
  return json(500, { error: GENERIC_ERROR })
}

async function handle(deps: HandlerDeps, req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' })

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')
  if (!match) return json(401, { error: 'No autenticado' })

  const caller = await deps.getCaller(match[1])
  if (!caller) return json(401, { error: 'No autenticado' })

  const callerProfile = await deps.getCallerProfile(caller.authUserId)
  if (!callerProfile || callerProfile.role !== 'admin' || !callerProfile.active) {
    return json(403, { error: 'No tienes permiso para crear personal' })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Solicitud inválida' })
  }
  const parsed = parseCreateStaffInput(body)
  if (!parsed.ok) return json(400, { error: parsed.error })
  const { email, password, fullName, role } = parsed.value

  const created = await deps.createUser({
    email,
    password,
    email_confirm: true,
    ban_duration: '876000h',
    // Tenant always comes from the caller's profile, never from the request body.
    app_metadata: { role, restaurant_id: callerProfile.restaurantId },
    user_metadata: { full_name: fullName },
  })
  if (!created.ok) {
    if (created.reason === 'duplicate') return json(409, { error: 'Ya existe una cuenta con ese correo electrónico' })
    if (created.reason === 'weak_password') {
      return json(400, { error: 'La contraseña no cumple los requisitos de seguridad' })
    }
    return json(500, { error: GENERIC_ERROR })
  }
  const userId = created.userId

  // From here on the user exists but is banned: any failure must delete it.
  let step = 'applyProfile'
  try {
    // GoTrue stores app_metadata after the insert, so handle_new_user() may have
    // created the profile with defaults; set the real role and tenant explicitly.
    const applied = await deps.applyProfile({ authUserId: userId, role, restaurantId: callerProfile.restaurantId, fullName })
    if (!applied) return await rollback(deps, userId, step)

    step = 'readProfile'
    const profile = await deps.readProfile(userId)
    if (!profile) return await rollback(deps, userId, step)

    step = 'activateUser'
    if (!(await deps.activateUser(userId))) return await rollback(deps, userId, step)

    return json(201, {
      profile: { id: profile.id, fullName: profile.full_name, email: profile.email, role: profile.role },
    })
  } catch {
    return await rollback(deps, userId, step)
  }
}
