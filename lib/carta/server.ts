import { unstable_cache } from "next/cache"
import type { Carta, CartaDishShare } from "./types"

/**
 * The only server-side carta reads: link previews for Open Graph (`/c/<slug>`
 * and `/c/<slug>/p/<dish>` metadata, S7). Every guest read stays in the
 * browser (A2: the API rate-limits public carta reads per client IP, 120/min).
 * These calls all come from the web container's IP, so each is cached per
 * slug for 5 minutes with `unstable_cache` (the root layout is
 * force-dynamic, which would otherwise skip the fetch cache): crawlers never
 * spend more than one read per slug per window. Same target as the proxy in
 * next.config.mjs (`API_PROXY_TARGET`). A 2 s timeout keeps a slow API from
 * holding the page; any failure returns null and the static metadata.
 */
const API_ORIGIN = (process.env.API_PROXY_TARGET ?? "http://localhost:4000").replace(/\/+$/, "")
const TIMEOUT_MS = 2_000
const REVALIDATE_S = 300

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: { "accept-language": "es" },
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** Raw read of the public delivery carta (the same one `/c/<slug>` shows). */
export function fetchCartaPreview(slug: string): Promise<Carta | null> {
  return readJson<Carta>(`/api/carta/${encodeURIComponent(slug)}?channel=delivery&lang=es`)
}

export function fetchDishPreviewRaw(slug: string, dishId: string): Promise<CartaDishShare | null> {
  return readJson<CartaDishShare>(`/api/carta/${encodeURIComponent(slug)}/p/${encodeURIComponent(dishId)}`)
}

/** Cached wrappers; a null (failure) result is not cached, so a hiccup does not stick. */
export async function cachedCartaPreview(slug: string): Promise<Carta | null> {
  try {
    return await unstable_cache(
      async () => {
        const carta = await fetchCartaPreview(slug)
        if (!carta) throw new Error("carta preview unavailable")
        return carta
      },
      ["carta-preview", slug],
      { revalidate: REVALIDATE_S, tags: [`carta:${slug}`] },
    )()
  } catch {
    return null
  }
}

export async function fetchDishPreview(slug: string, dishId: string): Promise<CartaDishShare | null> {
  try {
    return await unstable_cache(
      async () => {
        const preview = await fetchDishPreviewRaw(slug, dishId)
        if (!preview) throw new Error("dish preview unavailable")
        return preview
      },
      ["carta-dish-preview", slug, dishId],
      { revalidate: REVALIDATE_S, tags: [`carta:${slug}`] },
    )()
  } catch {
    return null
  }
}
