import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/LandingPage"
import { BRAND_NAME } from "@/lib/brand"

const title = `${BRAND_NAME} · Tu restaurante, por fin en sincronía`
const description =
  "Punto de venta para restaurantes: mesero, cocina, caja y administración conectados en tiempo real, con inventario por receta, cobros blindados e impresión automática."

// H-108: share tags (WhatsApp, redes) and the canonical URL of the landing.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title,
    description,
    url: "/",
    siteName: BRAND_NAME,
    locale: "es_CO",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: BRAND_NAME }],
  },
  twitter: { card: "summary", title, description, images: ["/icon-512.png"] },
}

export default function Page() {
  return <LandingPage />
}
