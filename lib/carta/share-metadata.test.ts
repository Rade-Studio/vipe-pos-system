import { afterEach, describe, expect, it, vi } from "vitest"
import { carta } from "@/components/carta/carta-fixtures"
import { CARTA_FALLBACK_METADATA, cartaShareMetadata, SHARE_FALLBACK_DESCRIPTION } from "./share-metadata"
import { fetchCartaPreview } from "./server"
import type { Carta } from "./types"

const URL_ = "https://vipe.example/c/brasa-y-lena"

function withSettings(settings: Partial<Carta["settings"]>): Carta {
  const base = carta()
  return { ...base, settings: { ...base.settings, ...settings } }
}

describe("cartaShareMetadata (S7)", () => {
  it("puts the restaurant name in title, og:title and siteName", () => {
    const m = cartaShareMetadata(carta(), URL_)
    expect(m.title).toBe("Brasa & Leña")
    expect(m.openGraph).toMatchObject({ title: "Brasa & Leña", siteName: "Brasa & Leña", type: "website", url: URL_ })
    expect(m.robots).toEqual({ index: false })
  })

  it("uses the restaurant description, else a localized fallback", () => {
    expect(cartaShareMetadata(carta(), URL_).description).toBe("Parrilla colombiana · Chapinero, Bogotá")
    const m = cartaShareMetadata(withSettings({ description: "  " }), URL_)
    expect(m.description).toBe(SHARE_FALLBACK_DESCRIPTION)
    expect(m.openGraph?.description).toBe(SHARE_FALLBACK_DESCRIPTION)
  })

  it("prefers the cover over the logo, with a large card", () => {
    const m = cartaShareMetadata(withSettings({ coverUrl: "https://s3/c.jpg", logoUrl: "https://s3/l.png" }), URL_)
    expect(m.openGraph?.images).toEqual([{ url: "https://s3/c.jpg", width: 1600, height: 600 }])
    expect(m.twitter).toMatchObject({ card: "summary_large_image" })
  })

  it("uses the logo when there is no cover, with a small card", () => {
    const m = cartaShareMetadata(withSettings({ logoUrl: "https://s3/l.png" }), URL_)
    expect(m.openGraph?.images).toEqual([{ url: "https://s3/l.png" }])
    expect(m.twitter).toMatchObject({ card: "summary" })
  })

  it("sets no images when there is neither", () => {
    const m = cartaShareMetadata(carta(), undefined)
    expect(m.openGraph?.images).toBeUndefined()
    expect(m.openGraph).not.toHaveProperty("url")
  })

  it("falls back to the static metadata without a carta", () => {
    expect(cartaShareMetadata(null, URL_)).toEqual(CARTA_FALLBACK_METADATA)
    expect(CARTA_FALLBACK_METADATA).toEqual({ title: "Carta", robots: { index: false } })
  })
})

describe("fetchCartaPreview (S7)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("returns null instead of throwing when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
    await expect(fetchCartaPreview("x")).resolves.toBeNull()
  })

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })))
    await expect(fetchCartaPreview("x")).resolves.toBeNull()
  })

  it("reads the public delivery carta in es with a timeout", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(carta()), { status: 200 }))
    vi.stubGlobal("fetch", f)
    await expect(fetchCartaPreview("brasa y")).resolves.toMatchObject({ restaurant: { name: "Brasa & Leña" } })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe("http://localhost:4000/api/carta/brasa%20y?channel=delivery&lang=es")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
