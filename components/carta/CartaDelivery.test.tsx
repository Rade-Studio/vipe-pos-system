import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import type { components } from "@/lib/api/schema"
import type { Carta } from "@/lib/carta/types"
import { CartaPage } from "./CartaPage"
import { CartaTracking } from "./CartaTracking"
import { carta } from "./carta-fixtures"

/** T7 (S15, S16) — delivery checkout, tracking, "Ver mi pedido" and the WhatsApp fallback. */

type GuestPricing = components["schemas"]["GuestPricing"]
type GuestDeliveryStatus = components["schemas"]["GuestDeliveryStatus"]

const env = vi.hoisted(() => ({
  carta: null as unknown as Carta,
  pricing: null as unknown as GuestPricing,
  status: null as unknown as GuestDeliveryStatus,
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
}))

vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: env.post } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: env.push, replace: env.push }) }))

const SLUG = "brasa-y-lena"
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx"
const LIST_KEY = `vipe:carta:list:${SLUG}`
const TRACK_KEY = `vipe:carta:delivery:${SLUG}`

function withSettings(s: Partial<Carta["settings"]>, rest: Partial<Carta> = {}): Carta {
  const base = carta(rest)
  return { ...base, settings: { ...base.settings, ...s } }
}

const PRICING: GuestPricing = {
  channel: "delivery",
  lines: [
    {
      dishId: "coco",
      name: "Limonada de coco",
      quantity: 2,
      unitPrice: 9900,
      promotionId: "pr-1",
      promotionName: "2x1",
      discounts: [{ kind: "promotion_item", promotionId: "pr-1", label: "2x1", amount: 9900 }],
    },
  ],
  billDiscount: null,
  grossSubtotal: 19800,
  totalDiscounts: 9900,
  netSubtotal: 9900,
  taxPercentage: 8,
  tax: 792,
  deliveryFee: 4000,
  total: 14692,
}

function status(overrides: Partial<GuestDeliveryStatus> = {}): GuestDeliveryStatus {
  return {
    status: "pending",
    stage: "pending",
    rejectReason: null,
    createdAt: "2026-11-12T19:05:00",
    lines: [{ name: "Limonada de coco", quantity: 2 }],
    deliveryFee: 4000,
    total: null,
    orderNumber: null,
    paymentMethod: "cash",
    ...overrides,
  }
}

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const tabs = () => screen.getByRole("navigation", { name: "Secciones de la carta" })

async function renderCarta() {
  render(wrap(<CartaPage slug={SLUG} />))
  await screen.findByRole("heading", { level: 1, name: "Brasa & Leña" })
}

async function addCocoTwiceAndOpen() {
  await renderCarta()
  fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Limonada de coco" }))
  fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Limonada de coco" }))
  fireEvent.click(within(tabs()).getByRole("button", { name: "Pedido (2)" }))
  await screen.findByRole("heading", { name: "Tu pedido a domicilio" })
}

function fillForm(cash = "") {
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Laura Gómez" } })
  fireEvent.change(screen.getByLabelText("Celular"), { target: { value: "300 123-4567" } })
  fireEvent.change(screen.getByLabelText("Dirección"), { target: { value: "Calle 63 # 9-42, apto 501" } })
  fireEvent.change(screen.getByLabelText("Barrio"), { target: { value: "Chapinero Alto" } })
  if (cash) fireEvent.change(screen.getByLabelText("¿Con cuánto pagas? (para llevar el cambio)"), { target: { value: cash } })
}

beforeEach(() => {
  window.localStorage.clear()
  env.carta = withSettings({ deliveryOrderingEnabled: true })
  env.pricing = PRICING
  env.status = status()
  env.push.mockReset()
  env.get.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/carta/{slug}") return { data: env.carta }
    if (path === "/api/carta/{slug}/delivery/{trackingToken}") return { data: env.status }
    throw new Error(`unexpected GET ${path}`)
  })
  env.post.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/carta/{slug}/pricing-preview") return { data: env.pricing }
    if (path === "/api/carta/{slug}/delivery") {
      return { data: { requestId: "r-1", trackingToken: TOKEN, status: "pending", createdAt: "2026-11-12T19:05:00" } }
    }
    throw new Error(`unexpected POST ${path}`)
  })
})

describe("delivery checkout (S15)", () => {
  it("shows the cart, the form and the preview totals with promotions, Envío and tax", async () => {
    await addCocoTwiceAndOpen()
    expect(screen.getByText("¿A quién y a dónde lo llevamos?")).toBeInTheDocument()
    for (const label of ["Efectivo", "Datáfono", "Transferencia (Nequi / Daviplata)"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument()
    }
    const totals = await screen.findByRole("region", { name: "Resumen del pedido" })
    expect(within(totals).getByText("2 × Limonada de coco")).toBeInTheDocument()
    expect(within(totals).getByText("$19.800")).toBeInTheDocument()
    expect(within(totals).getByText("2x1")).toBeInTheDocument()
    expect(within(totals).getByText("−$9.900")).toBeInTheDocument()
    expect(within(totals).getByText("Envío")).toBeInTheDocument()
    expect(within(totals).getByText("$4.000")).toBeInTheDocument()
    expect(within(totals).getByText("Impuesto")).toBeInTheDocument()
    expect(within(totals).getByText("$792")).toBeInTheDocument()
    expect(within(totals).getByText("$14.692")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar pedido · $14.692" })).toBeEnabled()
    expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/pricing-preview", {
      params: { path: { slug: SLUG } },
      body: { channel: "delivery", items: [{ dishId: "coco", quantity: 2 }] },
    })
  })

  it("hides the tax row when the tax is 0", async () => {
    env.pricing = { ...PRICING, taxPercentage: 0, tax: 0, total: 13900 }
    await addCocoTwiceAndOpen()
    expect(await screen.findByRole("button", { name: "Enviar pedido · $13.900" })).toBeInTheDocument()
    expect(screen.queryByText("Impuesto")).not.toBeInTheDocument()
  })

  it("the phone field strips spaces and dashes and rejects letters inline", async () => {
    await addCocoTwiceAndOpen()
    const phone = screen.getByLabelText("Celular")
    fireEvent.change(phone, { target: { value: "300 12-3" } })
    expect(phone).toHaveValue("300123")
    fireEvent.change(phone, { target: { value: "300123x" } })
    expect(phone).toHaveValue("300123")
    expect(phone).toHaveAccessibleDescription("Escribe solo números.")
    fireEvent.click(await screen.findByRole("button", { name: "Enviar pedido · $14.692" }))
    expect(await screen.findByText("Escribe un celular de 10 dígitos, como 300 123 4567.")).toBeInTheDocument()
    expect(env.post).not.toHaveBeenCalledWith("/api/carta/{slug}/delivery", expect.anything())
  })

  it("cash must cover the total", async () => {
    await addCocoTwiceAndOpen()
    fillForm("10.000")
    fireEvent.click(await screen.findByRole("button", { name: "Enviar pedido · $14.692" }))
    expect(await screen.findByText("Debe ser igual o mayor que el total ($14.692).")).toBeInTheDocument()
    expect(screen.getByLabelText("¿Con cuánto pagas? (para llevar el cambio)")).toHaveAttribute("aria-invalid", "true")
    expect(env.post).not.toHaveBeenCalledWith("/api/carta/{slug}/delivery", expect.anything())
  })

  it("submit posts the exact body, remembers the token, clears the cart and opens the tracking page", async () => {
    await addCocoTwiceAndOpen()
    fillForm("$20.000")
    fireEvent.change(screen.getByLabelText("Indicaciones para el domiciliario (opcional)"), { target: { value: "Portería" } })
    fireEvent.click(await screen.findByRole("button", { name: "Enviar pedido · $14.692" }))
    await waitFor(() => expect(env.push).toHaveBeenCalledWith(`/c/${SLUG}/d/${TOKEN}`))
    expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/delivery", {
      params: { path: { slug: SLUG } },
      body: {
        customer: { name: "Laura Gómez", phone: "3001234567", address: "Calle 63 # 9-42, apto 501", neighborhood: "Chapinero Alto" },
        items: [{ dishId: "coco", quantity: 2 }],
        payment: { method: "cash", cashFrom: 20000 },
        notes: "Portería",
      },
    })
    expect(window.localStorage.getItem(TRACK_KEY)).toBe(TOKEN)
    expect(window.localStorage.getItem(LIST_KEY)).toBeNull()
  })

  it("card payment sends no cash amount", async () => {
    await addCocoTwiceAndOpen()
    fillForm()
    fireEvent.click(screen.getByRole("radio", { name: "Datáfono" }))
    expect(screen.queryByLabelText("¿Con cuánto pagas? (para llevar el cambio)")).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "Enviar pedido · $14.692" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/delivery", expect.objectContaining({ body: expect.objectContaining({ payment: { method: "card" } }) })),
    )
  })

  it("an API refusal stays inline and keeps the form and the cart", async () => {
    await addCocoTwiceAndOpen()
    fillForm()
    env.post.mockImplementation(async (path: string) => {
      if (path === "/api/carta/{slug}/pricing-preview") return { data: env.pricing }
      throw new ApiError(409, "Conflict", "Ahora estamos cerrados: podrás enviar el pedido cuando abramos.")
    })
    fireEvent.click(await screen.findByRole("button", { name: "Enviar pedido · $14.692" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ahora estamos cerrados: podrás enviar el pedido cuando abramos.")
    expect(screen.getByLabelText("Nombre")).toHaveValue("Laura Gómez")
    expect(within(tabs()).getByRole("button", { name: "Pedido (2)" })).toBeInTheDocument()
    expect(env.push).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(TRACK_KEY)).toBeNull()
  })

  it("closed: the send button is disabled with the closed note", async () => {
    window.localStorage.setItem(
      LIST_KEY,
      JSON.stringify([{ key: "coco||", dishId: "coco", name: "Limonada de coco", qty: 1, unitPrice: 9900, options: [], note: null }]),
    )
    env.carta = withSettings({ deliveryOrderingEnabled: true }, { isOpenNow: false, closesAt: null, nextOpening: { date: "2026-11-13", opensAt: "07:00", inDays: 1 } })
    await renderCarta()
    fireEvent.click(within(tabs()).getByRole("button", { name: "Pedido (1)" }))
    expect(await screen.findByRole("button", { name: /^Enviar pedido/ })).toBeDisabled()
    expect(screen.getByText("Ahora estamos cerrados: podrás enviar el pedido cuando abramos.")).toBeInTheDocument()
  })
})

describe("Ver mi pedido (S15)", () => {
  it("links to the last order while it is not delivered or rejected", async () => {
    window.localStorage.setItem(TRACK_KEY, TOKEN)
    env.status = status({ status: "confirmed", stage: "out_for_delivery", orderNumber: 142 })
    await renderCarta()
    expect(await screen.findByRole("link", { name: "Ver mi pedido" })).toHaveAttribute("href", `/c/${SLUG}/d/${TOKEN}`)
  })

  it("forgets a delivered order", async () => {
    window.localStorage.setItem(TRACK_KEY, TOKEN)
    env.status = status({ status: "confirmed", stage: "delivered", orderNumber: 142 })
    await renderCarta()
    await waitFor(() => expect(window.localStorage.getItem(TRACK_KEY)).toBeNull())
    expect(screen.queryByRole("link", { name: "Ver mi pedido" })).not.toBeInTheDocument()
  })

  it.each(["failed", "cancelled"] as const)("forgets a %s order too: it is over for the guest", async (stage) => {
    window.localStorage.setItem(TRACK_KEY, TOKEN)
    env.status = status({ status: "confirmed", stage, orderNumber: 142 })
    await renderCarta()
    await waitFor(() => expect(window.localStorage.getItem(TRACK_KEY)).toBeNull())
    expect(screen.queryByRole("link", { name: "Ver mi pedido" })).not.toBeInTheDocument()
  })
})

describe("tracking page (S15)", () => {
  async function renderTracking() {
    render(wrap(<CartaTracking slug={SLUG} trackingToken={TOKEN} />))
  }
  const steps = () => within(screen.getByRole("list", { name: "Estado del pedido" }))

  it("pending: 'Pedido recibido', only Recibido done, lines and the payment method", async () => {
    await renderTracking()
    expect(await screen.findByRole("heading", { name: "Pedido recibido" })).toBeInTheDocument()
    expect(steps().getAllByText("✓")).toHaveLength(1)
    expect(steps().getByText("Recibido")).toBeInTheDocument()
    expect(steps().getByText("Confirmado")).toBeInTheDocument()
    expect(screen.getByText("2 × Limonada de coco")).toBeInTheDocument()
    expect(screen.getByText("Efectivo")).toBeInTheDocument()
    expect(env.get).toHaveBeenCalledWith("/api/carta/{slug}/delivery/{trackingToken}", { params: { path: { slug: SLUG, trackingToken: TOKEN } } })
  })

  it("on the way: the order number, three steps done and the total", async () => {
    env.status = status({ status: "confirmed", stage: "out_for_delivery", orderNumber: 142, total: 14692, paymentMethod: "transfer" })
    await renderTracking()
    expect(await screen.findByRole("heading", { name: "Pedido D-0142" })).toBeInTheDocument()
    expect(steps().getAllByText("✓")).toHaveLength(3)
    expect(screen.getByText("$14.692")).toBeInTheDocument()
    expect(screen.getByText("Transferencia (Nequi / Daviplata)")).toBeInTheDocument()
  })

  it("confirmed (preparing) counts as Confirmado; delivered marks all four", async () => {
    env.status = status({ status: "confirmed", stage: "preparing", orderNumber: 142 })
    await renderTracking()
    await screen.findByRole("heading", { name: "Pedido D-0142" })
    expect(steps().getAllByText("✓")).toHaveLength(2)
  })

  it("rejected shows the reason and no steps", async () => {
    env.status = status({ status: "rejected", stage: "rejected", rejectReason: "No llegamos a ese barrio" })
    await renderTracking()
    expect(await screen.findByText("Rechazado")).toBeInTheDocument()
    expect(screen.getByText("Motivo: No llegamos a ese barrio")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Estado del pedido" })).not.toBeInTheDocument()
  })

  it("failed and cancelled are said plainly", async () => {
    env.status = status({ status: "confirmed", stage: "failed", orderNumber: 7 })
    const view = render(wrap(<CartaTracking slug={SLUG} trackingToken={TOKEN} />))
    expect(await screen.findByText("No pudimos entregar el pedido.")).toBeInTheDocument()
    view.unmount()
    env.status = status({ status: "confirmed", stage: "cancelled", orderNumber: 7 })
    await renderTracking()
    expect(await screen.findByText("El pedido se canceló.")).toBeInTheDocument()
  })

  it("an unknown token shows not found", async () => {
    env.get.mockImplementation(async (path: string) => {
      if (path === "/api/carta/{slug}") return { data: env.carta }
      throw new ApiError(404, "Not Found", "No encontramos este pedido.")
    })
    await renderTracking()
    expect(await screen.findByRole("heading", { name: "No encontramos este pedido." })).toBeInTheDocument()
  })

  it("offers 'Compartir la carta con alguien'", async () => {
    await renderTracking()
    fireEvent.click(await screen.findByRole("button", { name: "Compartir la carta con alguien" }))
    expect(await screen.findByRole("dialog", { name: "Compartir la carta" })).toBeInTheDocument()
  })
})

describe("WhatsApp fallback (S16)", () => {
  it("composes the message and links wa.me with it encoded; VIPE receives nothing", async () => {
    env.carta = withSettings({ deliveryOrderingEnabled: false, whatsapp: "573001234567" })
    await addCocoTwiceAndOpen()
    expect(screen.getByText("Este restaurante recibe los domicilios por WhatsApp. Te armamos el mensaje: solo envíalo.")).toBeInTheDocument()
    const text = "Hola Brasa & Leña, quiero pedir:\n2 × Limonada de coco\nTotal aprox.: $23.800"
    const link = screen.getByRole("link", { name: "Abrir WhatsApp" })
    expect(link).toHaveAttribute("href", `https://wa.me/573001234567?text=${encodeURIComponent(text)}`)
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument()
    expect(env.post).not.toHaveBeenCalled()
  })
})
