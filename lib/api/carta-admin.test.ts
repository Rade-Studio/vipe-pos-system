import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"

/** T8b (S17) — Ajustes · Carta digital through the typed API client. */

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))

import {
  brandHint,
  closesAfterMidnight,
  daypartErrors,
  fieldOfError,
  guestUrl,
  normalizeSettings,
  regenerateAllQr,
  regenerateTableQr,
  saveCartaSettings,
  saveDayparts,
  saveDishDetails,
  slugError,
  slugHint,
  updateSlug,
  uploadCartaAsset,
  whatsappHint,
  type CartaAdminSettings,
} from "./carta-admin"

const settings: CartaAdminSettings = {
  description: "  Parrilla a la leña ",
  brandColor: "#9a3412",
  logoUrl: null,
  coverUrl: null,
  instagram: "",
  tiktok: null,
  whatsapp: "573104567890",
  mapsUrl: null,
  googleReviewUrl: null,
  tableOrderingEnabled: true,
  deliveryOrderingEnabled: false,
  showTableBill: true,
  englishEnabled: false,
  openingHours: null,
  published: true,
}

beforeEach(() => {
  api.GET.mockReset()
  api.PUT.mockReset()
  api.POST.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("carta admin requests", () => {
  it("saves the whole settings form with blanks as null", async () => {
    api.PUT.mockResolvedValue({ data: { ...settings, description: "Parrilla a la leña", instagram: null } })
    const saved = await saveCartaSettings(settings)
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/settings", {
      body: { ...settings, description: "Parrilla a la leña", instagram: null },
    })
    expect(saved.description).toBe("Parrilla a la leña")
    expect(normalizeSettings(settings).instagram).toBeNull()
  })

  it("replaces the dayparts with the list in its order", async () => {
    api.PUT.mockResolvedValue({ data: [] })
    await saveDayparts([
      { name: " Desayuno ", nameEn: "", startsAt: "07:00", endsAt: "11:00", featuredDishId: null, categoryIds: ["c-1"] },
    ])
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/dayparts", {
      body: {
        dayparts: [
          { name: "Desayuno", nameEn: null, startsAt: "07:00", endsAt: "11:00", sortOrder: 0, featuredDishId: null, categoryIds: ["c-1"] },
        ],
      },
    })
  })

  it("saves a dish's tags and English description", async () => {
    api.PUT.mockResolvedValue({ data: { dishId: "d-1", tags: ["spicy"], descriptionEn: null, descriptionEnReviewed: false } })
    await saveDishDetails("d-1", { tags: ["spicy"], descriptionEn: "  ", descriptionEnReviewed: false })
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/dishes/{dishId}", {
      params: { path: { dishId: "d-1" } },
      body: { tags: ["spicy"], descriptionEn: null, descriptionEnReviewed: false },
    })
  })

  it("regenerates one table or all of them", async () => {
    api.POST.mockResolvedValue({ data: { tables: [] } })
    await regenerateAllQr()
    expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/tables/qr")
    api.POST.mockResolvedValue({ data: { id: "t-1" } })
    await regenerateTableQr("t-1")
    expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/tables/{tableId}/qr", { params: { path: { tableId: "t-1" } } })
  })

  it("changes the slug and keeps the API's 409/422 words", async () => {
    api.PUT.mockResolvedValue({ data: { slug: "la-parrilla" } })
    await updateSlug("la-parrilla")
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/slug", { body: { slug: "la-parrilla" } })
    expect(slugError(new ApiError(409, "Conflict", "Ese enlace ya lo usa otro restaurante"))).toBe(
      "Ese enlace ya lo usa otro restaurante",
    )
    expect(slugError(new ApiError(422, "Unprocessable", "Usa solo minúsculas"))).toBe("Usa solo minúsculas")
    expect(slugError(new Error("boom"))).toBe("No se pudo cambiar el enlace. Intenta de nuevo.")
  })

  it("uploads an asset: presign, then PUT the bytes to the ticket URL", async () => {
    api.POST.mockResolvedValue({ data: { uploadUrl: "https://bucket/put", publicUrl: "https://cdn/logo.png" } })
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["png"], "logo.png", { type: "image/png" })
    await expect(uploadCartaAsset("logo", file)).resolves.toBe("https://cdn/logo.png")
    expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/assets", { body: { kind: "logo", contentType: "image/png", size: 3 } })
    expect(fetchMock).toHaveBeenCalledWith("https://bucket/put", { method: "PUT", headers: { "Content-Type": "image/png" }, body: file })
  })

  it("refuses a non-image before any request and reports a failed PUT", async () => {
    await expect(uploadCartaAsset("cover", new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow(
      "Por favor, selecciona una imagen",
    )
    await expect(uploadCartaAsset("cover", new File(["gif"], "a.gif", { type: "image/gif" }))).rejects.toThrow(
      "Sube una imagen PNG, JPG o WebP (no SVG).",
    )
    expect(api.POST).not.toHaveBeenCalled()
    api.POST.mockResolvedValue({ data: { uploadUrl: "https://bucket/put", publicUrl: "https://cdn/c.png" } })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })))
    await expect(uploadCartaAsset("cover", new File(["png"], "c.png", { type: "image/png" }))).rejects.toThrow(
      "No se pudo subir la imagen",
    )
  })
})

describe("carta admin rules", () => {
  it("slug format hint", () => {
    expect(slugHint("la-parrilla")).toBeNull()
    expect(slugHint("")).toBe("Escribe un nombre para el enlace.")
    expect(slugHint("La Parrilla")).toBe(
      "Usa minúsculas y números separados por guiones (sin tildes, espacios ni guiones al inicio o al final), hasta 64 caracteres.",
    )
    expect(slugHint("-parrilla")).not.toBeNull()
    expect(slugHint("la--parrilla")).not.toBeNull()
    expect(slugHint("parrilla-")).not.toBeNull()
    expect(slugHint("a".repeat(64))).toBeNull()
    expect(slugHint("a".repeat(65))).not.toBeNull()
  })

  it("WhatsApp: 7–15 digits", () => {
    expect(whatsappHint("")).toBeNull()
    expect(whatsappHint("573104567890")).toBeNull()
    expect(whatsappHint("12345")).toBe("El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.")
    expect(whatsappHint("57 310")).not.toBeNull()
  })

  it("brand AA hint: says when the color is adjusted", () => {
    expect(brandHint("#9a3412")).toMatchObject({ adjusted: false, message: "Se lee bien sobre fondo claro y oscuro." })
    const yellow = brandHint("#fde047")
    expect(yellow.adjusted).toBe(true)
    expect(yellow.message).toMatch(/^Lo ajustamos para que se lea bien: usamos #[0-9a-f]{6} en botones y textos\.$/)
  })

  it("opening hours: a close earlier than the open is after midnight", () => {
    expect(closesAfterMidnight({ opens: "17:00", closes: "02:00" })).toBe(true)
    expect(closesAfterMidnight({ opens: "07:00", closes: "22:30" })).toBe(false)
  })

  it("dayparts: name required and from before to", () => {
    const ok = { name: "Desayuno", nameEn: null, startsAt: "07:00", endsAt: "11:00", featuredDishId: null, categoryIds: [] }
    expect(daypartErrors([ok])).toEqual({})
    expect(daypartErrors([ok, { ...ok, startsAt: "20:00", endsAt: "01:00" }])).toEqual({
      1: "La franja debe empezar antes de terminar (no cruza la medianoche).",
    })
    expect(daypartErrors([{ ...ok, name: " " }])).toEqual({ 0: "Escribe el nombre de la franja." })
  })

  it("maps an API message to its field and builds the guest URL", () => {
    expect(fieldOfError("El WhatsApp debe tener de 7 a 15 dígitos.")).toBe("whatsapp")
    expect(fieldOfError("El enlace de Google Maps debe empezar por https://")).toBe("mapsUrl")
    expect(fieldOfError("El enlace para reseñas debe ser https")).toBe("googleReviewUrl")
    expect(fieldOfError("Algo raro")).toBeNull()
    expect(guestUrl("https://vipe.app", "/c/x/m/tok")).toBe("https://vipe.app/c/x/m/tok")
  })
})
