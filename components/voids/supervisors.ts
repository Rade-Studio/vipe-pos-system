import { listStaff } from "@/lib/api/staff"
import type { Supervisor } from "./flow"

export const SUPERVISORS_QUERY_KEY = ["void-supervisors"] as const

/**
 * The tiles of step 2 until F4 lands `GET /staff/supervisors` (admin, cashier
 * and waiter; lib/api/staff.ts `listSupervisors`, same shape): today only an
 * admin can read `GET /staff`, so the cashier and waiter screens show "No se
 * pudo cargar quién autoriza" until then. Swap this body for `listSupervisors()`.
 */
export async function loadSupervisors(): Promise<Supervisor[]> {
  return (await listStaff())
    .filter((member) => member.active && (member.role === "admin" || member.role === "cashier"))
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      role: member.role as Supervisor["role"],
      hasPin: member.hasPin,
      pinLockedUntil: member.pinLockedUntil,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"))
}
