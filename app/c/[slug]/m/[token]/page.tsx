import type { Metadata } from "next"
import { CartaPage } from "@/components/carta/CartaPage"

// A table QR: never indexed, never shared (share links drop the token).
export const metadata: Metadata = { title: "Carta", robots: { index: false, follow: false } }

export default async function Page({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params
  return <CartaPage slug={slug} token={token} />
}
