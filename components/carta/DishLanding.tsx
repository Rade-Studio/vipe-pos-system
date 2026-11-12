"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { failureOf, fetchDishShare } from "@/lib/carta/api"
import { brandCss, brandPalette } from "@/lib/carta/brand"
import { formatCop } from "@/lib/carta/format"
import { STRINGS } from "@/lib/carta/i18n"
import { cartaPath } from "@/lib/carta/share"
import { cn } from "@/lib/utils"
import { CartaFailureView, CartaSkeleton } from "./CartaStates"
import { DishPhoto } from "./DishPhoto"
import { BRAND_FILL, CTA, FOCUS } from "./styles"

/**
 * Landing of a shared dish (`/c/<slug>/p/<dish>`, S9): the dish and a link
 * to the carta. Read from the browser like the carta; the share endpoint
 * carries no brand, so the default palette applies.
 */
export function DishLanding({ slug, dishId }: { slug: string; dishId: string }) {
  const t = STRINGS.es
  const query = useQuery({
    queryKey: ["carta-dish", slug, dishId],
    queryFn: () => fetchDishShare(slug, dishId),
    retry: false,
    refetchOnWindowFocus: false,
  })
  if (query.isError) return <CartaFailureView failure={failureOf(query.error)} t={t} onRetry={() => void query.refetch()} />
  if (!query.data) return <CartaSkeleton t={t} />
  const { restaurant, dish } = query.data
  return (
    <main className="carta-root mx-auto grid min-h-dvh w-full max-w-[480px] content-start gap-4 overflow-x-hidden bg-canvas px-[18px] pb-10 pt-6 text-fg">
      <style>{brandCss(brandPalette(null))}</style>
      <p className="text-sm font-semibold text-muted-fg">{restaurant.name}</p>
      <DishPhoto src={dish.imageUrl} sizes="480px" className="aspect-[4/3] w-full rounded-card-lg" />
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{dish.name}</h1>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatCop(dish.price)}</p>
        {dish.description && <p className="mt-2 text-[14.5px] text-muted-fg">{dish.description}</p>}
      </div>
      <Link href={cartaPath(restaurant.slug)} className={cn(CTA, BRAND_FILL, "grid place-items-center", FOCUS)}>
        {t.seeCarta}
      </Link>
    </main>
  )
}
