import type { CartaDishShare } from "./types"

/**
 * The one server-side carta read: the dish link preview for Open Graph
 * (`/c/<slug>/p/<dish>` metadata). It is cached, so crawlers do not spend the
 * guests' rate limit; every guest read stays in the browser (A2). Same
 * target as the dev proxy in next.config.mjs.
 */
const API_ORIGIN = (process.env.API_PROXY_TARGET ?? "http://localhost:4000").replace(/\/+$/, "")

export async function fetchDishPreview(slug: string, dishId: string): Promise<CartaDishShare | null> {
  try {
    const response = await fetch(
      `${API_ORIGIN}/api/carta/${encodeURIComponent(slug)}/p/${encodeURIComponent(dishId)}`,
      { next: { revalidate: 300 } },
    )
    if (!response.ok) return null
    return (await response.json()) as CartaDishShare
  } catch {
    return null
  }
}
