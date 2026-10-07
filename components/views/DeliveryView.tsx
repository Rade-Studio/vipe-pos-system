"use client"

import { Header } from "@/components/layout/Header"
import type { Profile } from "@/types"
import type { DeliveryRole } from "@/lib/delivery/types"
import { DeliveryBoard } from "@/components/delivery/DeliveryBoard"

interface DeliveryViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

/**
 * Delivery operator view: header on top, board below. Tasks 5+ wires
 * the actual board + new-order flow; the previous placeholder shell
 * only proved the role reached this component.
 *
 * `profile.role` is the impersonated role (the operator is using a
 * delivery_operator profile); `authRole` is the REAL signed-in
 * user's role, which we prefer so an admin operator sees the admin
 * permissions on the board (delivery_operator actions only).
 */
export function DeliveryView({ profile, onChangeProfile, authRole }: DeliveryViewProps) {
  const role = resolveDeliveryRole(profile.role, authRole)
  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        profile={profile}
        onChangeProfile={onChangeProfile}
        authRole={authRole}
        title="Domicilios"
      />
      <main className="flex-1 overflow-auto p-4">
        <DeliveryBoard role={role} />
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