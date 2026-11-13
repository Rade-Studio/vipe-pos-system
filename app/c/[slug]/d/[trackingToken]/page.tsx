import type { Metadata } from "next"
import { CartaTracking } from "@/components/carta/CartaTracking"

// One guest's order: never indexed, never followed.
export const metadata: Metadata = { title: "Tu pedido", robots: { index: false, follow: false }, referrer: "no-referrer" }

export default async function Page({ params }: { params: Promise<{ slug: string; trackingToken: string }> }) {
  const { slug, trackingToken } = await params
  return <CartaTracking slug={slug} trackingToken={trackingToken} />
}
