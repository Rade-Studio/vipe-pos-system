import type { Metadata } from "next"
import { DishLanding } from "@/components/carta/DishLanding"
import { fetchDishPreview } from "@/lib/carta/server"

type Params = Promise<{ slug: string; dishId: string }>

/** Open Graph preview of a shared dish: the only server-side carta read. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, dishId } = await params
  const preview = await fetchDishPreview(slug, dishId)
  if (!preview) return { title: "Carta", robots: { index: false } }
  const title = `${preview.dish.name} · ${preview.restaurant.name}`
  const description = preview.dish.description ?? undefined
  const images = preview.dish.imageUrl ? [{ url: preview.dish.imageUrl }] : undefined
  return { title, description, openGraph: { title, description, images }, twitter: { card: images ? "summary_large_image" : "summary" } }
}

export default async function Page({ params }: { params: Params }) {
  const { slug, dishId } = await params
  return <DishLanding slug={slug} dishId={dishId} />
}
