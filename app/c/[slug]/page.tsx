import type { Metadata } from "next"
import { headers } from "next/headers"
import { CartaPage } from "@/components/carta/CartaPage"
import { cachedCartaPreview } from "@/lib/carta/server"
import { cartaShareMetadata } from "@/lib/carta/share-metadata"

type Params = Promise<{ slug: string }>

/** The public origin of this request, behind the reverse proxy; undefined when unknown. */
async function canonicalUrl(slug: string): Promise<string | undefined> {
  try {
    const h = await headers()
    const host = h.get("x-forwarded-host") ?? h.get("host")
    if (!host) return undefined
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"
    return `${proto}://${host}/c/${encodeURIComponent(slug)}`
  } catch {
    return undefined
  }
}

/**
 * Link preview with the restaurant (S7). The menu itself is still read in the
 * browser (A2: the API rate-limits per guest IP); this one server read is
 * cached per slug, see lib/carta/server.ts.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const [carta, url] = await Promise.all([cachedCartaPreview(slug), canonicalUrl(slug)])
  return cartaShareMetadata(carta, url)
}

export default async function Page({ params }: { params: Params }) {
  const { slug } = await params
  return <CartaPage slug={slug} />
}
