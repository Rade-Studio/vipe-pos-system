/**
 * Single source of truth for the app-level role names and the role -> view
 * routing used by `app/page.tsx`. The database column `profiles.role` is a
 * plain varchar (no CHECK) so widening is purely additive; this file is the
 * only place the canonical set lives.
 *
 * `APP_ROLES` is the ordered tuple every other piece of the app should read
 * from. `types/index.ts` derives its `ProfileRole` type from it.
 */

export const APP_ROLES = [
  'admin',
  'cashier',
  'waiter',
  'kitchen',
  'delivery_operator',
] as const

export type AppRole = (typeof APP_ROLES)[number]

/**
 * View key returned by `viewForRole`. `null` means "no view, render the
 * fallback" and is how the router signals an unknown role to the user.
 */
export type RoleViewKey = 'admin' | 'cashier' | 'waiter' | 'kitchen' | 'delivery' | null

const APP_ROLE_SET: ReadonlySet<string> = new Set(APP_ROLES)

/**
 * Narrow an arbitrary value (typically coming from the DB) to a known
 * `AppRole`. Returns `false` for anything that is not one of the
 * canonical app role strings.
 */
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLE_SET.has(value)
}

const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrador',
  cashier: 'Caja',
  waiter: 'Mesero',
  kitchen: 'Cocina',
  delivery_operator: 'Operador de domicilios',
}

/**
 * Human-readable Spanish label for a role. Returns `null` for unknown
 * values so callers can decide how to surface an invalid role instead
 * of silently showing a placeholder.
 */
export function roleLabel(role: string | null | undefined): string | null {
  if (role == null) return null
  return isAppRole(role) ? ROLE_LABELS[role] : null
}

const ROLE_VIEW: Record<AppRole, Exclude<RoleViewKey, null>> = {
  admin: 'admin',
  cashier: 'cashier',
  waiter: 'waiter',
  kitchen: 'kitchen',
  delivery_operator: 'delivery',
}

/**
 * Map a role to the view key the router uses to pick a top-level
 * component. `null` means "no mapping" and triggers the fallback
 * (`Perfil no válido`).
 */
export function viewForRole(role: string | null | undefined): RoleViewKey {
  if (role == null) return null
  return isAppRole(role) ? ROLE_VIEW[role] : null
}
