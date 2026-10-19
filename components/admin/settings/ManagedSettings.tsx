"use client"

import { CouriersManager } from "@/components/admin/couriers/CouriersManager"
import { DeliveryFeeSetting } from "@/components/admin/couriers/DeliveryFeeSetting"
import { PaymentMethodsManager } from "@/components/admin/payment-methods/PaymentMethodsManager"
import { WaiterList } from "@/components/admin/staff/WaiterList"
import { SettingsPage } from "./SettingsPage"

// These pages save per item through their own dialogs, so they have no SaveBar.

export function PaymentMethodsSettings() {
  return (
    <SettingsPage title="Métodos de pago" description="Medios de pago que el cajero puede registrar.">
      <PaymentMethodsManager />
    </SettingsPage>
  )
}

export function DeliverySettings() {
  return (
    <SettingsPage title="Domicilios" description="Repartidores y valor sugerido del domicilio.">
      <DeliveryFeeSetting />
      <CouriersManager />
    </SettingsPage>
  )
}

export function StaffSettings() {
  return (
    <SettingsPage title="Personal" description="Usuarios del equipo y su rol.">
      <WaiterList />
    </SettingsPage>
  )
}
