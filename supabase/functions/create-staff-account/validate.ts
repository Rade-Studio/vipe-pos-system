// Runtime-agnostic input validation for create-staff-account (no Deno or Node APIs).

export const CREATABLE_ROLES = ['waiter', 'kitchen', 'cashier', 'delivery_operator'] as const
export type CreatableRole = (typeof CREATABLE_ROLES)[number]

export interface CreateStaffInput {
  email: string
  password: string
  fullName: string
  role: CreatableRole
}

export type ParseResult = { ok: true; value: CreateStaffInput } | { ok: false; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseCreateStaffInput(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Solicitud inválida' }
  }
  const raw = body as Record<string, unknown>

  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'El correo electrónico no es válido' }

  const password = raw.password
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }
  }

  const fullName = typeof raw.fullName === 'string' ? raw.fullName.trim() : ''
  if (fullName.length < 1 || fullName.length > 100) {
    return { ok: false, error: 'El nombre debe tener entre 1 y 100 caracteres' }
  }

  const role = raw.role
  if (typeof role !== 'string' || !(CREATABLE_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: 'El rol no es válido' }
  }

  return { ok: true, value: { email, password, fullName, role: role as CreatableRole } }
}
