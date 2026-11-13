import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import type { CartaAdmin } from "@/lib/api/carta-admin"

/** T8b (S17) — Ajustes · Carta digital over a mocked API. */

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), POST: vi.fn() }))
vi.mock("@/lib/api/client", () => ({ api }))
const toastMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }))

import { CartaSettingsPage } from "./CartaSettingsPage"

function fixture(): CartaAdmin {
  return {
    restaurant: { name: "Brasa & Leña", slug: "brasa-y-lena", publicPath: "/c/brasa-y-lena", timezone: "America/Bogota" },
    settings: {
      description: "Parrilla a la leña",
      brandColor: "#9a3412",
      logoUrl: null,
      coverUrl: null,
      instagram: "brasaylena",
      tiktok: null,
      whatsapp: "573104567890",
      mapsUrl: null,
      googleReviewUrl: null,
      tableOrderingEnabled: true,
      deliveryOrderingEnabled: false,
      showTableBill: true,
      englishEnabled: true,
      openingHours: {
        1: null,
        2: { opens: "07:00", closes: "22:30" },
        3: { opens: "07:00", closes: "22:30" },
        4: { opens: "07:00", closes: "22:30" },
        5: { opens: "07:00", closes: "23:30" },
        6: { opens: "08:00", closes: "23:30" },
        7: { opens: "08:00", closes: "17:00" },
      },
      published: true,
    },
    dayparts: [
      { id: "dp-1", name: "Desayuno", nameEn: "Breakfast", startsAt: "07:00", endsAt: "11:00", sortOrder: 0, featuredDishId: null, categoryIds: ["c-1"] },
    ],
    categories: [
      { id: "c-1", name: "Parrilla", active: true },
      { id: "c-2", name: "Bebidas", active: true },
    ],
    dishes: [
      {
        id: "d-1",
        name: "Churrasco a la leña",
        description: "Punta de anca madurada",
        price: 48000,
        categoryId: "c-1",
        imageUrl: null,
        active: true,
        tags: ["gluten_free"],
        descriptionEn: "Aged rump cap",
        descriptionEnReviewed: true,
        mostOrdered: true,
      },
      {
        id: "d-2",
        name: "Chorizo santarrosano",
        description: "Chorizo artesanal",
        price: 16000,
        categoryId: "c-1",
        imageUrl: null,
        active: true,
        tags: [],
        descriptionEn: null,
        descriptionEnReviewed: false,
        mostOrdered: false,
      },
    ],
    tables: [
      { id: "t-4", number: 4, zoneName: "Salón", token: "tok-4", guestPath: "/c/brasa-y-lena/m/tok-4" },
      { id: "t-10", number: 10, zoneName: "Terraza", token: "tok-10", guestPath: "/c/brasa-y-lena/m/tok-10" },
    ],
    deliveryDefaultFee: 4000,
  }
}

const saveBar = () => screen.queryByRole("region", { name: "Cambios sin guardar" })

async function renderPage(onNavigate = vi.fn()) {
  render(<CartaSettingsPage onNavigate={onNavigate} />)
  await screen.findByRole("heading", { name: "Carta digital", level: 1 })
  return onNavigate
}

beforeEach(() => {
  api.GET.mockReset().mockImplementation(async () => ({ data: fixture() }))
  api.PUT.mockReset()
  api.POST.mockReset()
  toastMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CartaSettingsPage — settings form", () => {
  it("loads the settings, shows the save bar once edited, discards and saves", async () => {
    await renderPage()
    expect(api.GET).toHaveBeenCalledWith("/api/carta-admin")
    expect(screen.getByText(`${window.location.origin}/c/brasa-y-lena`)).toBeTruthy()
    expect(saveBar()).toBeNull()

    const description = screen.getByLabelText("Descripción corta") as HTMLTextAreaElement
    fireEvent.change(description, { target: { value: "Parrilla y cocteles" } })
    expect(saveBar()).not.toBeNull()
    expect(screen.getByText("19 / 160")).toBeTruthy()

    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Descartar" }))
    expect(saveBar()).toBeNull()
    expect(description.value).toBe("Parrilla a la leña")

    fireEvent.change(description, { target: { value: "Parrilla y cocteles" } })
    api.PUT.mockResolvedValue({ data: { ...fixture().settings, description: "Parrilla y cocteles" } })
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(saveBar()).toBeNull())
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/settings", {
      body: expect.objectContaining({ description: "Parrilla y cocteles", published: true, englishEnabled: true }),
    })
  })

  it("shows the API's 422 message next to its field and keeps the changes", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "5731045678901" } })
    api.PUT.mockRejectedValue(new ApiError(422, "Unprocessable Entity", "El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país."))
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    const field = await screen.findByText("El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.")
    expect(field.id).toBe("carta-whatsapp-error")
    expect(screen.getByLabelText("WhatsApp").getAttribute("aria-invalid")).toBe("true")
    expect(saveBar()).not.toBeNull()
  })

  it("shows an unexpected save failure in the save bar", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Descripción corta"), { target: { value: "Nueva" } })
    api.PUT.mockRejectedValue(new ApiError(422, "Unprocessable Entity", "No pudimos guardar los cambios. Intenta de nuevo."))
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    expect(await within(saveBar()!).findByText("No pudimos guardar los cambios. Intenta de nuevo.")).toBeTruthy()
  })

  it("refuses an invalid WhatsApp inline, before any request", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "31a" } })
    expect(screen.getByText("El WhatsApp debe tener entre 7 y 15 dígitos, con el indicativo del país.")).toBeTruthy()
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    expect(await screen.findByText("Revisa los campos marcados.")).toBeTruthy()
    expect(api.PUT).not.toHaveBeenCalled()
  })

  it("brand color: a light swatch gets the AA adjustment hint", async () => {
    await renderPage()
    expect(screen.getByText("Se lee bien sobre fondo claro y oscuro.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Amarillo" }))
    expect(screen.getByRole("button", { name: "Amarillo" }).getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText(/^Lo ajustamos para que se lea bien: usamos #[0-9a-f]{6} en botones y textos\.$/)).toBeTruthy()
    expect(saveBar()).not.toBeNull()
  })

  it("opening hours: a close after midnight is allowed and saved as is", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Cierra el Martes"), { target: { value: "01:00" } })
    expect(screen.getByText("Cierra al día siguiente")).toBeTruthy()
    fireEvent.click(screen.getByRole("switch", { name: "Abierto el Lunes" }))
    api.PUT.mockResolvedValue({ data: fixture().settings })
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(api.PUT).toHaveBeenCalled())
    const body = api.PUT.mock.calls[0][1].body
    expect(body.openingHours[2]).toEqual({ opens: "07:00", closes: "01:00" })
    expect(body.openingHours[1]).toEqual({ opens: "08:00", closes: "22:00" })
  })

  it("ordering: shows the delivery fee read-only and links to Domicilios", async () => {
    const onNavigate = await renderPage()
    expect(screen.getByText("Valor del domicilio $4.000")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Cambiar en Ajustes · Domicilios" }))
    expect(onNavigate).toHaveBeenCalledWith("settings/delivery")
    fireEvent.click(screen.getByRole("switch", { name: "Pedidos a domicilio en línea" }))
    expect(saveBar()).not.toBeNull()
  })

  it("uploads a logo: presign, PUT to the bucket, then the form is dirty", async () => {
    await renderPage()
    api.POST.mockResolvedValue({ data: { uploadUrl: "https://bucket/put", publicUrl: "https://cdn/logo.png" } })
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["png"], "logo.png", { type: "image/png" })
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Subir logo"), { target: { files: [file] } })
    })
    await waitFor(() => expect(saveBar()).not.toBeNull())
    expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/assets", { body: { kind: "logo", contentType: "image/png", size: 3 } })
    expect(fetchMock).toHaveBeenCalledWith("https://bucket/put", expect.objectContaining({ method: "PUT" }))
    api.PUT.mockResolvedValue({ data: fixture().settings })
    fireEvent.click(within(saveBar()!).getByRole("button", { name: "Guardar cambios" }))
    await waitFor(() => expect(api.PUT).toHaveBeenCalled())
    expect(api.PUT.mock.calls[0][1].body.logoUrl).toBe("https://cdn/logo.png")
  })
})

describe("CartaSettingsPage — slug", () => {
  it("asks before changing the slug and shows the API's 409", async () => {
    await renderPage()
    const slug = screen.getByLabelText("Nombre en el enlace")
    fireEvent.change(slug, { target: { value: "La Parrilla" } })
    expect(screen.getByText("Usa minúsculas y números separados por guiones (sin tildes, espacios ni guiones al inicio o al final), hasta 64 caracteres.")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Cambiar enlace" }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(slug, { target: { value: "la-parrilla" } })
    fireEvent.click(screen.getByRole("button", { name: "Cambiar enlace" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(/Los QR impresos y los enlaces que compartiste con \/c\/brasa-y-lena dejarán de funcionar/)
    api.PUT.mockRejectedValue(new ApiError(409, "Conflict", "Ese enlace ya lo usa otro restaurante"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, cambiar enlace" }))
    expect(await screen.findByText("Ese enlace ya lo usa otro restaurante")).toBeTruthy()
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/slug", { body: { slug: "la-parrilla" } })
  })

  it("closing the confirmation returns focus to Cambiar enlace and shows /c/<slug> unbroken", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Nombre en el enlace"), { target: { value: "la-parrilla" } })
    const opener = screen.getByRole("button", { name: "Cambiar enlace" })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("/c/brasa-y-lena").tagName).toBe("CODE")
    expect(within(dialog).getByText("/c/brasa-y-lena")).toHaveClass("whitespace-nowrap")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it("after a confirmed change the public link and the QR links follow the new slug", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Nombre en el enlace"), { target: { value: "la-parrilla" } })
    fireEvent.click(screen.getByRole("button", { name: "Cambiar enlace" }))
    const next = fixture()
    next.restaurant = { ...next.restaurant, slug: "la-parrilla", publicPath: "/c/la-parrilla" }
    next.tables = next.tables.map((t) => ({ ...t, guestPath: t.guestPath.replace("brasa-y-lena", "la-parrilla") }))
    api.PUT.mockResolvedValue({ data: next.restaurant })
    api.GET.mockResolvedValue({ data: next })
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sí, cambiar enlace" }))
    expect(await screen.findByText(`${window.location.origin}/c/la-parrilla`)).toBeTruthy()
    expect(screen.getByText(`${window.location.origin}/c/la-parrilla/m/tok-4`)).toBeTruthy()
  })
})

describe("CartaSettingsPage — dayparts", () => {
  it("refuses from ≥ to and saves the list with PUT dayparts", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Agregar franja" }))
    fireEvent.change(screen.getByLabelText("Nombre de la franja 2"), { target: { value: "Noche" } })
    fireEvent.change(screen.getByLabelText("Desde (franja 2)"), { target: { value: "22:00" } })
    fireEvent.change(screen.getByLabelText("Hasta (franja 2)"), { target: { value: "18:00" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar franjas" }))
    expect(await screen.findByText("La franja debe empezar antes de terminar (no cruza la medianoche).")).toBeTruthy()
    expect(api.PUT).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText("Desde (franja 2)"), { target: { value: "18:00" } })
    fireEvent.change(screen.getByLabelText("Hasta (franja 2)"), { target: { value: "22:30" } })
    fireEvent.click(screen.getByRole("button", { name: "Bebidas en franja 2" }))
    fireEvent.change(screen.getByLabelText("Plato del día (franja 2)"), { target: { value: "d-2" } })
    api.PUT.mockResolvedValue({ data: fixture().dayparts })
    fireEvent.click(screen.getByRole("button", { name: "Guardar franjas" }))
    await waitFor(() => expect(api.PUT).toHaveBeenCalled())
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/dayparts", {
      body: {
        dayparts: [
          { name: "Desayuno", nameEn: "Breakfast", startsAt: "07:00", endsAt: "11:00", sortOrder: 0, featuredDishId: null, categoryIds: ["c-1"] },
          { name: "Noche", nameEn: null, startsAt: "18:00", endsAt: "22:30", sortOrder: 1, featuredDishId: "d-2", categoryIds: ["c-2"] },
        ],
      },
    })
  })
})

describe("CartaSettingsPage — dishes and English", () => {
  it("toggles a tag and saves that dish; Lo más pedido is automatic", async () => {
    await renderPage()
    const row = screen.getByRole("group", { name: "Etiquetas de Churrasco a la leña" })
    expect(within(row).getByText("★ Lo más pedido")).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "Picante" }))
    expect(within(row).getByRole("button", { name: "Picante" }).getAttribute("aria-pressed")).toBe("true")
    api.PUT.mockResolvedValue({ data: { dishId: "d-1", tags: ["gluten_free", "spicy"], descriptionEn: "Aged rump cap", descriptionEnReviewed: true } })
    fireEvent.click(within(row).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(api.PUT).toHaveBeenCalled())
    expect(api.PUT).toHaveBeenCalledWith("/api/carta-admin/dishes/{dishId}", {
      params: { path: { dishId: "d-1" } },
      body: { tags: ["gluten_free", "spicy"], descriptionEn: "Aged rump cap", descriptionEnReviewed: true },
    })
  })

  it("English: the chip follows descriptionEnReviewed and writing marks it reviewed", async () => {
    await renderPage()
    const reviewed = screen.getByRole("group", { name: "Inglés de Churrasco a la leña" })
    expect(within(reviewed).getByText("Revisada")).toBeTruthy()
    const pending = screen.getByRole("group", { name: "Inglés de Chorizo santarrosano" })
    expect(within(pending).getByText("Automática")).toBeTruthy()
    const text = within(pending).getByPlaceholderText("Escribe la descripción en inglés")
    fireEvent.change(text, { target: { value: "Handmade sausage" } })
    expect(within(pending).getByText("Revisada")).toBeTruthy()
    api.PUT.mockResolvedValue({ data: { dishId: "d-2", tags: [], descriptionEn: "Handmade sausage", descriptionEnReviewed: true } })
    fireEvent.click(within(pending).getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(api.PUT).toHaveBeenCalled())
    expect(api.PUT.mock.calls[0][1]).toEqual({
      params: { path: { dishId: "d-2" } },
      body: { tags: [], descriptionEn: "Handmade sausage", descriptionEnReviewed: true },
    })
  })
})

describe("CartaSettingsPage — table QR", () => {
  it("lists the tables by zone with the full guest URL", async () => {
    await renderPage()
    const terrace = screen.getByRole("region", { name: "Terraza" })
    expect(within(terrace).getByText("Mesa 10")).toBeTruthy()
    expect(within(terrace).getByText(`${window.location.origin}/c/brasa-y-lena/m/tok-10`)).toBeTruthy()
  })

  it("regenerates one table after the confirmation", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Regenerar QR de la mesa 4" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Los QR impresos dejarán de funcionar/)).toBeTruthy()
    api.POST.mockResolvedValue({ data: { id: "t-4", number: 4, zoneName: "Salón", token: "new-4", guestPath: "/c/brasa-y-lena/m/new-4" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, regenerar" }))
    expect(await screen.findByText(`${window.location.origin}/c/brasa-y-lena/m/new-4`)).toBeTruthy()
    expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/tables/{tableId}/qr", { params: { path: { tableId: "t-4" } } })
  })

  it("Escape on Regenerar todos returns focus to that button", async () => {
    await renderPage()
    const opener = screen.getByRole("button", { name: "Regenerar todos" })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it("regenerates all after the confirmation; cancel sends nothing", async () => {
    await renderPage()
    fireEvent.click(screen.getByRole("button", { name: "Regenerar todos" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.POST).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Regenerar todos" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Tendrás que imprimir y pegar los nuevos en las 2 mesas/)).toBeTruthy()
    api.POST.mockResolvedValue({ data: { tables: fixture().tables.map((t) => ({ ...t, guestPath: `${t.guestPath}-x` })) } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, regenerar" }))
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith("/api/carta-admin/tables/qr"))
    expect(await screen.findByText(`${window.location.origin}/c/brasa-y-lena/m/tok-4-x`)).toBeTruthy()
  })
})
