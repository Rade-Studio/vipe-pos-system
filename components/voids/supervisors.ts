import { listSupervisors } from "@/lib/api/staff"
import type { Supervisor } from "./flow"

export const SUPERVISORS_QUERY_KEY = ["void-supervisors"] as const

/**
 * The tiles of step 2: `GET /staff/supervisors` (F4) lists the restaurant's
 * active admins and cashiers for every role and for a shared terminal. Those
 * without a PIN stay in the list so the sheet shows them disabled ("Sin PIN").
 */
export async function loadSupervisors(): Promise<Supervisor[]> {
  return (await listSupervisors())
    .map((member) => ({
      id: member.id,
      fullName: member.fullName,
      role: member.role,
      hasPin: member.hasPin,
      pinLockedUntil: member.pinLockedUntil ?? null,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "es"))
}
