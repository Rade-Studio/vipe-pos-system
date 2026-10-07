"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Header } from "@/components/layout/Header"
import { Truck } from "lucide-react"
import type { Profile } from "@/types"

interface DeliveryViewProps {
  profile: Profile
  onChangeProfile: () => void
  authRole?: string
}

/**
 * Placeholder shell for the delivery operator view. The actual board,
 * customer/order flows and courier assignment land in later tasks; this
 * shell exists so the role can be routed to a real component today and
 * admins can confirm the role reaches the operator profile in the picker.
 */
export function DeliveryView({ profile, onChangeProfile, authRole }: DeliveryViewProps) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <Header
        profile={profile}
        onChangeProfile={onChangeProfile}
        authRole={authRole}
        title="Domicilios"
      />
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Truck className="h-6 w-6" />
            </div>
            <CardTitle>Domicilios</CardTitle>
            <CardDescription>Operador de domicilios</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            <p>La mesa de pedidos a domicilio llega en las próximas tareas.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
