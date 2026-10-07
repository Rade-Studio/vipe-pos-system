/**
 * Staff account creation. Calls the admin-only `create-staff-account` Edge
 * Function (service role lives server-side); the browser never sees it.
 */

import { supabase } from '@/lib/supabase/client'

export type StaffRole = 'waiter' | 'kitchen' | 'cashier' | 'delivery_operator'

export interface CreateStaffAccountInput {
  email: string
  password: string
  fullName: string
  role: StaffRole
}

export interface CreatedStaffProfile {
  id: string
  fullName: string
  email: string | null
  role: StaffRole
}

export type StaffServiceErrorKind = 'invalid' | 'forbidden' | 'duplicate' | 'unknown'

export class StaffServiceError extends Error {
  readonly kind: StaffServiceErrorKind
  constructor(kind: StaffServiceErrorKind, message: string) {
    super(message)
    this.name = 'StaffServiceError'
    this.kind = kind
  }
}

/** Minimal slice of the supabase-js client this service needs (eases faking in tests). */
export interface StaffFunctionsClient {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
  }
}

const MESSAGES: Record<StaffServiceErrorKind, string> = {
  invalid: 'Los datos ingresados no son válidos',
  forbidden: 'No tienes permiso para crear personal',
  duplicate: 'Ya existe una cuenta con ese correo electrónico',
  unknown: 'No se pudo crear la cuenta. Inténtalo de nuevo.',
}

function kindForStatus(status: number | undefined): StaffServiceErrorKind {
  if (status === 400) return 'invalid'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 409) return 'duplicate'
  return 'unknown'
}

/** Validation errors (400) carry a user-facing Spanish message from the function. */
async function serverMessage(error: unknown): Promise<string> {
  try {
    const body = await (error as { context: Response }).context.json()
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    // fall through to the generic message
  }
  return MESSAGES.invalid
}

export async function createStaffAccount(
  input: CreateStaffAccountInput,
  client: StaffFunctionsClient = supabase as unknown as StaffFunctionsClient,
): Promise<CreatedStaffProfile> {
  const { data, error } = await client.functions.invoke('create-staff-account', { body: input })

  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status
    const kind = kindForStatus(status)
    throw new StaffServiceError(kind, kind === 'invalid' ? await serverMessage(error) : MESSAGES[kind])
  }

  const profile = (data as { profile?: CreatedStaffProfile } | null)?.profile
  if (!profile) throw new StaffServiceError('unknown', MESSAGES.unknown)
  return profile
}
