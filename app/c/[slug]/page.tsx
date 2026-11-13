import type { Metadata } from "next"
import { CartaPage } from "@/components/carta/CartaPage"

// The menu is read in the browser (A2: the API rate-limits per guest IP).
export const metadata: Metadata = { title: "Carta", robots: { index: false } }

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <CartaPage slug={slug} />
}
