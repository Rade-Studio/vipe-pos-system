import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { Toaster } from "@/components/ui/toaster"
import { CartaPage } from "./CartaPage"
import { DishLanding } from "./DishLanding"
import { carta, TABLE_TOKEN, tableCarta } from "./carta-fixtures"

const get = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/client", () => ({ api: { GET: get } }))

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      {node}
      <Toaster />
    </QueryClientProvider>
  )
}

async function renderCarta(props: { slug?: string; token?: string } = {}) {
  const view = render(wrap(<CartaPage slug={props.slug ?? "brasa-y-lena"} token={props.token} />))
  await screen.findByRole("heading", { level: 1, name: "Brasa & Leña" })
  return view
}

function respond(body: unknown) {
  get.mockResolvedValue({ data: body })
}

beforeEach(() => {
  get.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("hero (S4)", () => {
  it("shows name, description, initials, the open chip and the delivery chips", async () => {
    respond(carta())
    await renderCarta()
    expect(screen.getByText("Parrilla colombiana · Chapinero, Bogotá")).toBeInTheDocument()
    expect(screen.getByText("B&L")).toBeInTheDocument()
    expect(screen.getByText("Abierto · cierra 10:30 pm")).toBeInTheDocument()
    expect(screen.getByText("Domicilio")).toBeInTheDocument()
    expect(screen.getByText("Envío $4.000")).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith(
      "/api/carta/{slug}",
      expect.objectContaining({
        params: expect.objectContaining({ path: { slug: "brasa-y-lena" }, query: { channel: "delivery" } }),
      }),
    )
  })

  it("links only the configured social networks, each with an accessible name", async () => {
    respond({ ...carta(), settings: { ...carta().settings, whatsapp: "573001234567" } })
    await renderCarta()
    expect(screen.getByRole("link", { name: "Instagram @brasaylena" })).toHaveAttribute("href", "https://instagram.com/brasaylena")
    expect(screen.getByRole("link", { name: "WhatsApp del restaurante" })).toHaveAttribute("href", "https://wa.me/573001234567")
    expect(screen.queryByRole("link", { name: /TikTok/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Google Maps/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Compartir" })).toBeInTheDocument()
  })

  it("shows the table chip on a table QR and reads the table route", async () => {
    respond(tableCarta())
    await renderCarta({ token: TABLE_TOKEN })
    expect(screen.getByText("Mesa 12 · Terraza")).toBeInTheDocument()
    expect(screen.queryByText("Domicilio")).not.toBeInTheDocument()
    expect(get).toHaveBeenCalledWith(
      "/api/carta/{slug}/m/{token}",
      expect.objectContaining({ params: expect.objectContaining({ path: { slug: "brasa-y-lena", token: TABLE_TOKEN } }) }),
    )
  })
})

describe("open, closed and dayparts (S5, A1)", () => {
  it("open on the current daypart: add buttons, the 'ahora' mark and the dish of the day", async () => {
    respond(carta())
    await renderCarta()
    expect(screen.getByRole("button", { name: "Agregar a mi lista: Lasaña de berenjena" })).toBeInTheDocument()
    const almuerzo = screen.getByRole("button", { name: /Almuerzo/ })
    expect(almuerzo).toHaveAttribute("aria-pressed", "true")
    expect(within(almuerzo).getByText("ahora")).toBeInTheDocument()
    expect(screen.getByText("Plato del día")).toBeInTheDocument()
  })

  it("closed: banner with the next opening and no add buttons, even with a current daypart", async () => {
    respond(carta({ isOpenNow: false, closesAt: null, nextOpening: { date: "2026-11-13", opensAt: "07:00", inDays: 1 } }))
    await renderCarta()
    const banner = screen.getByRole("status", { name: "Cerrado ahora" })
    expect(within(banner).getByText("Abrimos mañana a las 7:00 am. Puedes ver la carta con calma.")).toBeInTheDocument()
    expect(screen.getAllByText("Cerrado ahora").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Lasaña de berenjena")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Agregar a mi lista/ })).not.toBeInTheDocument()
  })

  it("viewing another daypart shows the peek banner, its categories and no add buttons", async () => {
    respond(carta())
    await renderCarta()
    fireEvent.click(screen.getByRole("button", { name: /Noche/ }))
    expect(screen.getByText("Estás viendo la carta de noche · se pide de 6:00 pm a 10:30 pm.")).toBeInTheDocument()
    expect(screen.getByText("Mojito de maracuyá")).toBeInTheDocument()
    expect(screen.queryByText("Lasaña de berenjena")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Agregar a mi lista/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Noche/ })).toHaveAttribute("aria-pressed", "true")
  })
})

describe("list (S6–S8)", () => {
  it("search filters, shows the empty state and clears", async () => {
    respond(carta())
    await renderCarta()
    const search = screen.getByRole("searchbox", { name: "Buscar en la carta" })
    fireEvent.change(search, { target: { value: "ricota" } })
    expect(screen.getByText("Lasaña de berenjena")).toBeInTheDocument()
    expect(screen.queryByText("Limonada de coco")).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: "zzz" } })
    expect(screen.getByText("No hay platos con «zzz».")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Borrar búsqueda" }))
    expect(search).toHaveValue("")
    expect(screen.getByText("Limonada de coco")).toBeInTheDocument()
  })

  it("a sold-out dish says 'Agotado hoy' and has no add button", async () => {
    respond(carta())
    await renderCarta()
    const row = screen.getByRole("button", { name: "Jugo de lulo, $7.500, Agotado hoy" }).closest("li") as HTMLElement
    expect(within(row).getByText("Agotado hoy")).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: /Agregar/ })).not.toBeInTheDocument()
  })

  it("shows the dish tags and the promotion badge with its end", async () => {
    respond(carta())
    await renderCarta()
    const lasana = screen.getByRole("button", { name: "Lasaña de berenjena, $29.900" })
    expect(within(lasana).getByText("Vegetariano")).toBeInTheDocument()
    expect(within(lasana).getByText("Lácteos")).toBeInTheDocument()
    const churrasco = screen.getByRole("button", { name: "Churrasco 300 g, $42.900" })
    expect(within(churrasco).getByText("Sin gluten")).toBeInTheDocument()
    expect(within(churrasco).getByText("Lo más pedido")).toBeInTheDocument()
    expect(screen.getByText("2x1 hasta 4:00 pm")).toBeInTheDocument()
  })

  it("dish sheet: required group gates the CTA, the price follows the options, Escape returns focus", async () => {
    respond(carta())
    await renderCarta()
    const trigger = screen.getByRole("button", { name: "Churrasco 300 g, $42.900" })
    trigger.focus()
    fireEvent.click(trigger)
    const sheet = await screen.findByRole("dialog", { name: "Churrasco 300 g" })
    expect(within(sheet).getByText("Obligatorio")).toBeInTheDocument()
    expect(within(sheet).getByRole("button", { name: "Agregar · $42.900" })).toBeDisabled()
    fireEvent.click(within(sheet).getByRole("radio", { name: /Arroz con coco/ }))
    expect(within(sheet).getByRole("button", { name: "Agregar · $45.900" })).toBeEnabled()
    fireEvent.click(within(sheet).getByRole("checkbox", { name: /Chorizo/ }))
    expect(within(sheet).getByRole("button", { name: "Agregar · $51.900" })).toBeEnabled()
    expect(within(sheet).getByLabelText("Comentario para la cocina (opcional)")).toBeInTheDocument()
    fireEvent.keyDown(sheet, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe("Mi lista (S11)", () => {
  it("adds, steps and removes, persisted per slug", async () => {
    respond(carta())
    const view = await renderCarta()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi lista: Lasaña de berenjena" }))
    expect(screen.getByRole("button", { name: "Mi lista (1)" })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem("vipe:carta:list:brasa-y-lena") ?? "[]")).toMatchObject([
      { dishId: "lasana", qty: 1, unitPrice: 29900 },
    ])
    expect(window.localStorage.getItem("vipe:carta:list:otro")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Mi lista (1)" }))
    expect(screen.getByText("Este restaurante toma los pedidos en la mesa. Muéstrale esta lista a tu mesero.")).toBeInTheDocument()
    expect(screen.getByText("La lista vive solo en tu celular: nada se envía a la cocina.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agregar uno: Lasaña de berenjena" }))
    expect(screen.getByRole("button", { name: "Mi lista (2)" })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem("vipe:carta:list:brasa-y-lena") ?? "[]")[0].qty).toBe(2)

    view.unmount()
    await renderCarta()
    expect(screen.getByRole("button", { name: "Mi lista (2)" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mi lista (2)" }))
    fireEvent.click(screen.getByRole("button", { name: "Quitar uno: Lasaña de berenjena" }))
    fireEvent.click(screen.getByRole("button", { name: "Quitar uno: Lasaña de berenjena" }))
    expect(screen.getByText("Tu lista está vacía. Toca + en los platos que te antojen.")).toBeInTheDocument()
    expect(window.localStorage.getItem("vipe:carta:list:brasa-y-lena")).toBeNull()
  })

  it("keeps another restaurant's list apart", async () => {
    window.localStorage.setItem(
      "vipe:carta:list:otro",
      JSON.stringify([{ key: "x||", dishId: "x", name: "X", qty: 3, unitPrice: 1, options: [], note: null }]),
    )
    respond(carta())
    await renderCarta()
    expect(screen.getByRole("button", { name: "Mi lista" })).toBeInTheDocument()
  })

  it("a dish with options goes to the list with them from the sheet", async () => {
    respond(carta())
    await renderCarta()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi lista: Churrasco 300 g" }))
    const sheet = await screen.findByRole("dialog", { name: "Churrasco 300 g" })
    fireEvent.click(within(sheet).getByRole("radio", { name: /Papa criolla/ }))
    fireEvent.click(within(sheet).getByRole("button", { name: "Agregar · $42.900" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Mi lista (1)" }))
    expect(screen.getByText("Papa criolla")).toBeInTheDocument()
  })
})

describe("share (S9)", () => {
  it("never puts the table token in the shared link and copies it with a toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    respond(tableCarta())
    await renderCarta({ token: TABLE_TOKEN })
    fireEvent.click(screen.getByRole("button", { name: "Compartir" }))
    const sheet = await screen.findByRole("dialog", { name: "Compartir la carta" })
    expect(within(sheet).getByText("Sin la mesa: quien lo abra ve la carta, no tu cuenta.")).toBeInTheDocument()
    expect(within(sheet).getByText("Ver la carta")).toBeInTheDocument()
    const wa = within(sheet).getByRole("link", { name: "WhatsApp" })
    expect(wa.getAttribute("href")).toContain(encodeURIComponent("/c/brasa-y-lena"))
    expect(wa.getAttribute("href")).not.toContain(TABLE_TOKEN)
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Copiar enlace" }))
    })
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/c/brasa-y-lena`)
    expect(await screen.findByText("Enlace copiado")).toBeInTheDocument()
  })

  it("a dish link is /c/<slug>/p/<dish>, without the table", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    respond(tableCarta())
    await renderCarta({ token: TABLE_TOKEN })
    fireEvent.click(screen.getByRole("button", { name: "Lasaña de berenjena, $29.900" }))
    const sheet = await screen.findByRole("dialog", { name: "Lasaña de berenjena" })
    fireEvent.click(within(sheet).getByRole("button", { name: "Compartir: Lasaña de berenjena" }))
    const share = await screen.findByRole("dialog", { name: "Compartir este plato" })
    expect(within(share).getByText("Pídelo aquí")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(share).getByRole("button", { name: "Copiar enlace" }))
    })
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/c/brasa-y-lena/p/lasana`)
    expect(writeText.mock.calls[0][0]).not.toContain(TABLE_TOKEN)
  })
})

describe("language (S10)", () => {
  it("the EN switch asks for lang=en, uses descriptionEn, keeps Spanish names and shows the footer", async () => {
    respond(carta())
    await renderCarta()
    expect(screen.queryByText("Automatic translation reviewed by the restaurant.")).not.toBeInTheDocument()
    respond(carta({ lang: "en" }))
    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }))
    expect(await screen.findByText("Aged cut over wood fire, chimichurri and one side.")).toBeInTheDocument()
    expect(get).toHaveBeenLastCalledWith(
      "/api/carta/{slug}",
      expect.objectContaining({ params: expect.objectContaining({ query: { channel: "delivery", lang: "en" } }) }),
    )
    expect(screen.getByText("Churrasco 300 g")).toBeInTheDocument()
    expect(screen.getByText("Automatic translation reviewed by the restaurant.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cambiar a español" })).toBeInTheDocument()
  })
})

describe("states", () => {
  it("404 shows only the not-found message", async () => {
    get.mockRejectedValue(new ApiError(404, "Not Found", "No encontramos esta carta."))
    const { container } = render(wrap(<CartaPage slug="nadie" />))
    expect(await screen.findByText("No encontramos esta carta.")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Brasa|Mesa|Abierto|Cerrado/)
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument()
  })

  it("429 explains the limit and a network error offers a retry", async () => {
    get.mockRejectedValueOnce(new ApiError(429, "Too Many Requests", "Demasiadas solicitudes."))
    render(wrap(<CartaPage slug="brasa-y-lena" />))
    expect(await screen.findByText("Demasiadas solicitudes. Intenta de nuevo en un momento.")).toBeInTheDocument()
    get.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByText("No pudimos cargar la carta.")).toBeInTheDocument()
    respond(carta())
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByRole("heading", { level: 1, name: "Brasa & Leña" })).toBeInTheDocument()
  })

  it("shows a loading skeleton first", async () => {
    get.mockReturnValue(new Promise(() => {}))
    render(wrap(<CartaPage slug="brasa-y-lena" />))
    expect(screen.getByRole("status", { name: "Cargando la carta…" })).toBeInTheDocument()
  })
})

describe("dish landing (S9)", () => {
  it("shows the dish and links to the carta", async () => {
    get.mockResolvedValue({
      data: {
        restaurant: { name: "Brasa & Leña", slug: "brasa-y-lena" },
        dish: { id: "lasana", name: "Lasaña de berenjena", description: "Berenjena y ricota.", price: 29900, imageUrl: null },
      },
    })
    render(wrap(<DishLanding slug="brasa-y-lena" dishId="lasana" />))
    expect(await screen.findByRole("heading", { name: "Lasaña de berenjena" })).toBeInTheDocument()
    expect(screen.getByText("$29.900")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ver la carta" })).toHaveAttribute("href", "/c/brasa-y-lena")
  })
})
