import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { guestKeyStorageKey, type GuestProposal, type GuestTableBill, type GuestTableStatus } from "@/lib/carta/table"
import type { Carta } from "@/lib/carta/types"
import { CartaPage } from "./CartaPage"
import { carta, TABLE_TOKEN, tableCarta } from "./carta-fixtures"

/** T5 (S12–S14) — the table QR: "Mi pedido", proposal status, "La cuenta" and the review. */

const env = vi.hoisted(() => ({
  carta: null as unknown as Carta,
  status: null as unknown as GuestTableStatus,
  bill: null as GuestTableBill | null,
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock("@/lib/api/client", () => ({ api: { GET: env.get, POST: env.post } }))

const SLUG = "brasa-y-lena"
const GUEST_KEY = "k3J9xZ0qLmN4pQ7rS1tU2vW3"

function ordering(overrides: Partial<Carta["settings"]> = {}, rest: Partial<Carta> = {}): Carta {
  const base = tableCarta(rest)
  return { ...base, settings: { ...base.settings, tableOrderingEnabled: true, showTableBill: true, ...overrides } }
}

function status(overrides: Partial<GuestTableStatus> = {}): GuestTableStatus {
  return { isOpen: true, waiterFirstName: "Carolina", tableOrderingEnabled: true, showTableBill: true, proposals: [], requests: [], ...overrides }
}

function proposal(overrides: Partial<GuestProposal> = {}): GuestProposal {
  return {
    id: "p-1",
    status: "pending",
    stage: "pending",
    createdAt: "2026-11-12T12:41:00",
    decidedAt: null,
    rejectReason: null,
    lines: [{ name: "Lasaña de berenjena", quantity: 2 }],
    ...overrides,
  }
}

const BILL: GuestTableBill = {
  lines: [
    { name: "Churrasco 300 g", quantity: 1, unitPrice: 42900, lineTotal: 42900 },
    { name: "Limonada de coco", quantity: 2, unitPrice: 9900, lineTotal: 19800 },
    { name: "Lasaña de berenjena", quantity: 1, unitPrice: 29900, lineTotal: 29900 },
  ],
  discounts: [],
  grossSubtotal: 92600,
  totalDiscounts: 0,
  subtotal: 92600,
  tipPercentage: 10,
  updatedAt: "2026-11-12T12:58:00",
}

const notFound = () => new ApiError(404, "Not Found", "No encontramos esta carta.")

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

async function renderTable() {
  const view = render(wrap(<CartaPage slug={SLUG} token={TABLE_TOKEN} />))
  await screen.findByRole("heading", { level: 1, name: "Brasa & Leña" })
  return view
}

const tabs = () => screen.getByRole("navigation", { name: "Secciones de la carta" })
const openTab = (name: string) => fireEvent.click(within(tabs()).getByRole("button", { name: new RegExp(`^${name}`) }))

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem(guestKeyStorageKey(SLUG), GUEST_KEY)
  env.carta = ordering()
  env.status = status()
  env.bill = BILL
  env.get.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/carta/{slug}/m/{token}") return { data: env.carta }
    if (path === "/api/carta/{slug}/m/{token}/status") return { data: env.status }
    if (path === "/api/carta/{slug}/m/{token}/bill") {
      if (!env.bill) throw notFound()
      return { data: env.bill }
    }
    throw new Error(`unexpected GET ${path}`)
  })
  env.post.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/carta/{slug}/m/{token}/proposals") return { data: { proposalId: "p-1", status: "pending", createdAt: "2026-11-12T12:41:00" } }
    if (path === "/api/carta/{slug}/m/{token}/requests") return { data: { kind: "bill", createdAt: "x", alreadyPending: false } }
    if (path === "/api/carta/{slug}/feedback") return { data: undefined }
    throw new Error(`unexpected POST ${path}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("ordering mode (S11, S12)", () => {
  it("a table page with table ordering on adds to 'Mi pedido'", async () => {
    await renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    openTab("Mi pedido")
    expect(screen.getByRole("heading", { name: "Mi pedido · Mesa 12" })).toBeInTheDocument()
    expect(await screen.findByText("Nada se cobra ni se cocina hasta que Carolina lo confirme.")).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Enviar a Carolina · $29.900" })).toBeEnabled()
    expect(env.get).toHaveBeenCalledWith(
      "/api/carta/{slug}/m/{token}/status",
      expect.objectContaining({ params: { path: { slug: SLUG, token: TABLE_TOKEN }, query: { guestKey: GUEST_KEY } } }),
    )
  })

  it("table ordering off keeps 'Mi lista' and reads no status", async () => {
    env.carta = ordering({ tableOrderingEnabled: false, showTableBill: false })
    await renderTable()
    expect(screen.getByRole("button", { name: "Agregar a mi lista: Lasaña de berenjena" })).toBeInTheDocument()
    expect(within(tabs()).queryByRole("button", { name: /^Mi pedido/ })).not.toBeInTheDocument()
    expect(env.get).not.toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/status", expect.anything())
  })

  it("the delivery carta never proposes, even with table ordering on", async () => {
    env.get.mockImplementation(async () => ({ data: { ...carta(), settings: { ...carta().settings, tableOrderingEnabled: true } } }))
    render(wrap(<CartaPage slug={SLUG} />))
    expect(await screen.findByRole("button", { name: "Agregar a mi lista: Lasaña de berenjena" })).toBeInTheDocument()
  })

  it("without the waiter's name says 'tu mesero'", async () => {
    env.status = status({ waiterFirstName: null })
    await renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    openTab("Mi pedido")
    expect(await screen.findByRole("button", { name: "Enviar a tu mesero · $29.900" })).toBeInTheDocument()
    expect(screen.getByText("Nada se cobra ni se cocina hasta que tu mesero lo confirme.")).toBeInTheDocument()
  })
})

describe("send (S12)", () => {
  it("closed table: banner, explanation and the send button disabled", async () => {
    env.status = status({ isOpen: false })
    env.carta = ordering({}, { table: { number: 12, zoneName: "Terraza", isOpen: false } })
    await renderTable()
    const banner = screen.getByRole("status", { name: "Para pedir desde aquí, la mesa debe estar abierta" })
    expect(within(banner).getByText("Pídele a tu mesero que abra la mesa 12.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    openTab("Mi pedido")
    expect(await screen.findByRole("button", { name: /^Enviar a Carolina/ })).toBeDisabled()
    expect(screen.getAllByText("Pídele a tu mesero que abra la mesa 12.").length).toBeGreaterThanOrEqual(1)
  })

  it("closed carta: the send button disabled for lines kept from before", async () => {
    window.localStorage.setItem(
      "vipe:carta:list:brasa-y-lena",
      JSON.stringify([{ key: "lasana||", dishId: "lasana", name: "Lasaña de berenjena", qty: 1, unitPrice: 29900, options: [], note: null }]),
    )
    env.carta = ordering({}, { isOpenNow: false, closesAt: null, nextOpening: { date: "2026-11-13", opensAt: "07:00", inDays: 1 } })
    await renderTable()
    openTab("Mi pedido")
    expect(await screen.findByRole("button", { name: "Enviar a Carolina · $29.900" })).toBeDisabled()
    expect(screen.getByText("Ahora estamos cerrados: podrás enviar el pedido cuando abramos.")).toBeInTheDocument()
  })

  it("posts the normalized items with the guest key and note, then clears the cart and shows the proposal", async () => {
    await renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    openTab("Mi pedido")
    fireEvent.change(screen.getByLabelText("¿Alguna indicación para la cocina?"), { target: { value: "  sin pimienta " } })
    env.status = status({ proposals: [proposal()] })
    fireEvent.click(await screen.findByRole("button", { name: "Enviar a Carolina · $59.800" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/proposals", {
        params: { path: { slug: SLUG, token: TABLE_TOKEN } },
        body: { guestKey: GUEST_KEY, items: [{ dishId: "lasana", quantity: 2 }], note: "sin pimienta" },
      }),
    )
    expect(await screen.findByText("Esperando a Carolina…")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Enviar a Carolina/ })).not.toBeInTheDocument()
    expect(window.localStorage.getItem("vipe:carta:list:brasa-y-lena")).toBeNull()
  })

  it("shows the API's answer next to the button and keeps the cart", async () => {
    env.post.mockRejectedValueOnce(new ApiError(429, "Too Many Requests", "Ya enviaste varios pedidos; espera a que el mesero los revise."))
    await renderTable()
    fireEvent.click(screen.getByRole("button", { name: "Agregar a mi pedido: Lasaña de berenjena" }))
    openTab("Mi pedido")
    fireEvent.click(await screen.findByRole("button", { name: "Enviar a Carolina · $29.900" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya enviaste varios pedidos; espera a que el mesero los revise.")
    expect(await screen.findByRole("button", { name: "Enviar a Carolina · $29.900" })).toBeEnabled()
    expect(screen.getByText("Lasaña de berenjena")).toBeInTheDocument()
  })
})

describe("proposal status (S12)", () => {
  const steps = () => within(screen.getByRole("list", { name: "Estado del pedido" }))

  it("renders the stages from the status", async () => {
    env.status = status({ proposals: [proposal({ status: "confirmed", stage: "kitchen", decidedAt: "2026-11-12T12:43:00" })] })
    await renderTable()
    openTab("Mi pedido")
    expect(await screen.findByText("Tu pedido va en camino")).toBeInTheDocument()
    expect(steps().getByText("Enviado a Carolina").closest("li")).toHaveAttribute("data-state", "done")
    expect(steps().getByText("Confirmado por Carolina").closest("li")).toHaveAttribute("data-state", "done")
    expect(steps().getByText("En la cocina").closest("li")).toHaveAttribute("data-state", "done")
    expect(steps().getByText("Servido").closest("li")).toHaveAttribute("data-state", "now")
    expect(screen.getByText("2 × Lasaña de berenjena")).toBeInTheDocument()
  })

  it("shows a rejected proposal with its reason and a cancelled one as 'Anulado'", async () => {
    env.status = status({
      proposals: [
        proposal({ status: "rejected", stage: "rejected", rejectReason: "Se acabó la lasaña" }),
        proposal({ id: "p-2", status: "confirmed", stage: "cancelled" }),
      ],
    })
    await renderTable()
    openTab("Mi pedido")
    expect(await screen.findByText("Rechazado")).toBeInTheDocument()
    expect(screen.getByText("Motivo: Se acabó la lasaña")).toBeInTheDocument()
    expect(screen.getByText("Anulado")).toBeInTheDocument()
  })

  it("polls the status every 10 s while visible and on focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderTable()
    const statusCalls = () => env.get.mock.calls.filter(([p]) => p === "/api/carta/{slug}/m/{token}/status").length
    await waitFor(() => expect(statusCalls()).toBe(1))
    env.status = status({ proposals: [proposal({ status: "confirmed", stage: "served" })] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await waitFor(() => expect(statusCalls()).toBe(2))
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => expect(statusCalls()).toBe(3))
  })
})

describe("La cuenta (S13)", () => {
  async function openBill() {
    await renderTable()
    await waitFor(() => expect(within(tabs()).getByRole("button", { name: "La cuenta" })).toBeInTheDocument())
    openTab("La cuenta")
    return screen.findByRole("heading", { name: "La cuenta · Mesa 12" })
  }
  const mine = () => screen.getByTestId("te-toca")

  it("splits in equal parts with the people stepper and the tip toggle", async () => {
    await openBill()
    expect(screen.getByText("Total de la mesa").nextSibling).toHaveTextContent("$92.600")
    const tip = screen.getByRole("switch", { name: "Propina sugerida 10 % (voluntaria)" })
    expect(tip).toBeChecked()
    // 2 people by default: 46.300 + 10 %.
    expect(mine()).toHaveTextContent("Te toca$50.930")
    fireEvent.click(screen.getByRole("button", { name: "Una persona más" }))
    expect(mine()).toHaveTextContent("$33.954")
    fireEvent.click(tip)
    expect(mine()).toHaveTextContent("$30.867")
    expect(screen.getByText("Es una guía para ustedes: la caja cobra la cuenta completa o dividida, como se lo pidan al mesero.")).toBeInTheDocument()
  })

  it("splits by line: checking a line, 'Entre − N + personas', 'Solo yo' / 'Compartido entre N'", async () => {
    await openBill()
    fireEvent.click(screen.getByRole("button", { name: "Por lo que pedí" }))
    fireEvent.click(screen.getByRole("switch", { name: "Propina sugerida 10 % (voluntaria)" }))
    expect(mine()).toHaveTextContent("$0")
    fireEvent.click(screen.getByRole("checkbox", { name: "Esto es mío: Churrasco 300 g" }))
    expect(screen.getByText("Solo yo")).toBeInTheDocument()
    expect(mine()).toHaveTextContent("$42.900")
    fireEvent.click(screen.getByRole("checkbox", { name: "Esto es mío: Limonada de coco" }))
    const fewer = screen.getByRole("button", { name: "Una persona menos para Limonada de coco" })
    expect(fewer).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Una persona más para Limonada de coco" }))
    expect(screen.getByText("Compartido entre 2")).toBeInTheDocument()
    expect(screen.getByText("de $19.800")).toBeInTheDocument()
    expect(mine()).toHaveTextContent("$52.800")
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Una persona más para Limonada de coco" }))
    expect(screen.getByText("Compartido entre 12")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Una persona más para Limonada de coco" })).toBeDisabled()
  })

  it("is hidden when the bill answers 404 (table closed)", async () => {
    env.bill = null
    await renderTable()
    await waitFor(() => expect(env.get).toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/bill", expect.anything()))
    expect(within(tabs()).queryByRole("button", { name: "La cuenta" })).not.toBeInTheDocument()
  })

  it("is hidden and never read when showTableBill is off", async () => {
    env.carta = ordering({ showTableBill: false })
    await renderTable()
    expect(within(tabs()).queryByRole("button", { name: "La cuenta" })).not.toBeInTheDocument()
    expect(env.get).not.toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/bill", expect.anything())
  })
})

describe("ask for the bill and review (S14)", () => {
  async function askBill() {
    await renderTable()
    await waitFor(() => expect(within(tabs()).getByRole("button", { name: "La cuenta" })).toBeInTheDocument())
    openTab("La cuenta")
    fireEvent.click(await screen.findByRole("button", { name: "Pedir la cuenta a Carolina" }))
    return screen.findByText("Carolina ya viene con la cuenta.")
  }

  it("posts kind bill, then shows the stars", async () => {
    await askBill()
    expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/requests", {
      params: { path: { slug: SLUG, token: TABLE_TOKEN } },
      body: { kind: "bill" },
    })
    expect(screen.getByRole("group", { name: "Calificación de 1 a 5" })).toBeInTheDocument()
  })

  it.each([1, 3, 5])("shows the Google review link for %i stars (no gating)", async (stars) => {
    env.carta = ordering({ googleReviewUrl: "https://g.page/r/brasa/review" })
    await askBill()
    expect(screen.queryByRole("link", { name: "Escribir una reseña en Google" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: stars === 1 ? "1 estrella" : `${stars} estrellas` }))
    expect(screen.getByRole("link", { name: "Escribir una reseña en Google" })).toHaveAttribute("href", "https://g.page/r/brasa/review")
  })

  it("hides the Google link without a URL and posts the rating with the private comment", async () => {
    await askBill()
    fireEvent.click(screen.getByRole("button", { name: "2 estrellas" }))
    expect(screen.queryByRole("link", { name: "Escribir una reseña en Google" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("¿Algo que quieras contarle solo al restaurante? (opcional)"), {
      target: { value: "La sopa llegó fría" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/feedback", {
        params: { path: { slug: SLUG } },
        body: { token: TABLE_TOKEN, rating: 2, comment: "La sopa llegó fría" },
      }),
    )
    expect(await screen.findByText("¡Gracias! Se lo hicimos llegar al restaurante.")).toBeInTheDocument()
  })

  it("'Llamar al mesero' posts kind waiter", async () => {
    await renderTable()
    openTab("Mi pedido")
    fireEvent.click(screen.getByRole("button", { name: "Llamar al mesero" }))
    await waitFor(() =>
      expect(env.post).toHaveBeenCalledWith("/api/carta/{slug}/m/{token}/requests", {
        params: { path: { slug: SLUG, token: TABLE_TOKEN } },
        body: { kind: "waiter" },
      }),
    )
    expect(await screen.findByText("Le avisamos a Carolina.")).toBeInTheDocument()
  })

  it("with table ordering off asks nothing: 'Ya pedimos la cuenta' opens the review", async () => {
    env.carta = ordering({ tableOrderingEnabled: false })
    await renderTable()
    await waitFor(() => expect(within(tabs()).getByRole("button", { name: "La cuenta" })).toBeInTheDocument())
    openTab("La cuenta")
    fireEvent.click(await screen.findByRole("button", { name: "Ya pedimos la cuenta" }))
    expect(await screen.findByText("¡Gracias por venir!")).toBeInTheDocument()
    expect(env.post).not.toHaveBeenCalled()
  })
})
