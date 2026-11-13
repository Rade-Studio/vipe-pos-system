/**
 * Share links (S9). Built from the slug and the dish only: a link never
 * carries the table token, so whoever opens it sees the carta, not the bill.
 */

export function cartaPath(slug: string): string {
  return `/c/${encodeURIComponent(slug)}`
}

export function dishPath(slug: string, dishId: string): string {
  return `${cartaPath(slug)}/p/${encodeURIComponent(dishId)}`
}

export function shareUrl(origin: string, slug: string, dishId?: string): string {
  return `${origin.replace(/\/+$/, "")}${dishId ? dishPath(slug, dishId) : cartaPath(slug)}`
}

export function whatsappShareHref(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
}

/* -------------------------------------------------------- restaurant links */

export function instagramHref(handle: string): string {
  return `https://instagram.com/${encodeURIComponent(handle.replace(/^@/, ""))}`
}

export function tiktokHref(handle: string): string {
  return `https://www.tiktok.com/@${encodeURIComponent(handle.replace(/^@/, ""))}`
}

export function whatsappHref(digits: string): string {
  return `https://wa.me/${digits.replace(/\D/g, "")}`
}
