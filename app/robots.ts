import type { MetadataRoute } from "next"

/** H-108: the landing is public; the staff app and the API are not for crawlers. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/portal", "/api/"] } }
}
