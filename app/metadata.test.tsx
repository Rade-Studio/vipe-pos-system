import { describe, expect, it, vi } from "vitest"

vi.mock("next/font/google", () => ({ Inter: () => ({ className: "inter" }) }))
vi.mock("@/components/ClientProviders", () => ({ ClientProviders: () => null }))
vi.mock("@/components/landing/LandingPage", () => ({ LandingPage: () => null }))

import { metadata as rootMetadata } from "@/app/layout"
import { metadata } from "@/app/page"
import manifest from "@/app/manifest"
import robots from "@/app/robots"
import { BRAND_NAME } from "@/lib/brand"

/** H-108: share tags, canonical, manifest and robots for the landing. */
describe("landing metadata (H-108)", () => {
  it("has Open Graph, Twitter card and canonical", () => {
    expect(rootMetadata.metadataBase).toBeInstanceOf(URL)
    expect(metadata.alternates?.canonical).toBe("/")
    expect(metadata.openGraph).toMatchObject({
      title: metadata.title,
      description: metadata.description,
      siteName: BRAND_NAME,
      locale: "es_CO",
      type: "website",
      url: "/",
    })
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("/icon-512.png")
    expect(metadata.twitter).toMatchObject({ card: "summary", title: metadata.title, description: metadata.description })
  })

  it("has an installable manifest", () => {
    const m = manifest()
    expect(m).toMatchObject({ name: BRAND_NAME, short_name: BRAND_NAME, start_url: "/portal", display: "standalone", lang: "es" })
    expect(m.icons?.map((icon) => icon.sizes)).toEqual(["192x192", "512x512"])
  })

  it("lets crawlers index the landing but not the app", () => {
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/portal", "/api/"] })
  })
})
