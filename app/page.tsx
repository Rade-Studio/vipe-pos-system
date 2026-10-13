import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/LandingPage"

export const metadata: Metadata = {
  title: "VipePOS · Tu restaurante, por fin en sincronía",
  description:
    "Punto de venta para restaurantes: mesero, cocina, caja y administración conectados en tiempo real, con inventario por receta, cobros blindados e impresión automática.",
}

export default function Page() {
  return <LandingPage />
}
