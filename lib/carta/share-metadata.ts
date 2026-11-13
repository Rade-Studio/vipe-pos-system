import type { Metadata } from "next"
import type { Carta } from "./types"

/** What a shared `/c/<slug>` link shows when the carta cannot be read (S7). */
export const CARTA_FALLBACK_METADATA: Metadata = { title: "Carta", robots: { index: false } }

export const SHARE_FALLBACK_DESCRIPTION = "Mira la carta y pide desde tu mesa."

/** Cover art is uploaded at ≈1600×600 (admin Identidad). */
const COVER_SIZE = { width: 1600, height: 600 }

/**
 * Link preview (WhatsApp, Open Graph) of the public carta (S7): the
 * restaurant name, its hero description and its cover, else its logo, else the
 * app default image. Pure so it is tested without Next.
 */
export function cartaShareMetadata(carta: Carta | null, url: string | undefined): Metadata {
  if (!carta) return CARTA_FALLBACK_METADATA
  const name = carta.restaurant.name
  const description = carta.settings.description?.trim() || SHARE_FALLBACK_DESCRIPTION
  const { coverUrl, logoUrl } = carta.settings
  const images = coverUrl ? [{ url: coverUrl, ...COVER_SIZE }] : logoUrl ? [{ url: logoUrl }] : undefined
  return {
    title: name,
    description,
    robots: { index: false },
    openGraph: { title: name, description, type: "website", siteName: name, ...(url ? { url } : {}), images },
    twitter: { card: coverUrl ? "summary_large_image" : "summary", title: name, description },
  }
}
