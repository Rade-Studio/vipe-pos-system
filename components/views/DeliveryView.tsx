"use client"

import { Header } from "@/components/layout/Header"
import type { Profile } from "@/types"
import type { DeliveryRole } from "@/lib/delivery/types"
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"
import { RoleNav } from "@/components/delivery/RoleNav"
import { useProfileStore } from "@/store/useProfileStore"

interface DeliveryViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

/**
 * Delivery operator view: app header on top, the dispatch console
 * (T12) below; the console owns its own paddings and breakpoints.
 *
 * `profile.role` is the impersonated role (the operator is using a
 * delivery_operator profile); `authRole` is the REAL signed-in
 * user's role, which we prefer so an admin operator sees the admin
 * permissions on the board (delivery_operator actions only).
 *
 * T25: the console names the signed-in person (not the preview tile), and the
 * role nav shows only for a user with more than one role view: the admin,
 * who previews every role. A delivery operator has only this view, so none.
 */
export function DeliveryView({ profile, onChangeProfile, authRole }: DeliveryViewProps) {
  const role = resolveDeliveryRole(profile.role, authRole)
  const authProfile = useProfileStore((s) => s.authProfile)
  const operator = authProfile ?? profile
  const operatorName = (operator.full_name || operator.name || "").trim() || undefined
  const withRoleNav = authRole === "admin"
  return (
    <div className="flex h-[100dvh] flex-col bg-canvas">
      <div className="px-4 md:px-6 [&>header]:mb-0 [&>header]:bg-canvas">
        <Header
          profile={profile}
          onChangeProfile={onChangeProfile}
          authRole={authRole}
          title="Domicilios"
        />
      </div>
      {withRoleNav && <RoleNav />}
      <main className="min-w-0 flex-1 overflow-auto">
        <DeliveryBoard role={role} operatorName={operatorName} withRoleNav={withRoleNav} />
      </main>
    </div>
  )
}

function resolveDeliveryRole(
  profileRole: string | undefined,
  authRole: string | undefined,
): DeliveryRole {
  // Prefer the real signed-in role; an admin operator keeps admin
  // permissions (allowedActions), while the impersonated profile
  // decides the header label.
  const candidate: string | undefined = authRole ?? profileRole
  if (candidate === 'admin' || candidate === 'delivery_operator' || candidate === 'kitchen') {
    return candidate
  }
  // Cashiers and any other role fall back to delivery_operator so the
  // board renders sensible defaults; the server is still the
  // authority on transitions.
  return 'delivery_operator'
}