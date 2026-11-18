import type { MetadataRoute } from "next"
import { BRAND_NAME } from "@/lib/brand"

/** H-108: lets the staff install the app from the browser; it opens on the portal. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description: "Sistema de punto de venta para restaurantes",
    start_url: "/portal",
    display: "standalone",
    background_color: "#07060d",
    theme_color: "#7c3aed",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }
}
