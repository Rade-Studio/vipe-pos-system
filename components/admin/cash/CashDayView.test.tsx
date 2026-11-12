import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CashDay } from "@/lib/api/cash"

/**
 * caja-cierres T3 (S6-S7): the Día view (tablero 02) rendered
 * directly: names instead of ids, every method, tips apart, validate.
 */

const api = vi.hoisted(() => ({
  day: vi.fn(),
  validate: vi.fn(),
}))
vi.mock("@/lib/api/cash", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCashDay: api.day,
}))
vi.mock("@/lib/api/registers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateRegister: api.validate,
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { CashDayView } from "./CashDayView"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const UUID_T1 = "3f2b8c1e-1111-4a5b-9c7d-000000000001"
const UUID_T2 = "3f2b8c1e-2222-4a5b-9c7d-000000000002"

const METHOD_NAMES = ["Efectivo", "Tarjeta débito", "Tarjeta crédito", "Transferencia", "Nequi", "Daviplata"]
const methods = (totals: number[]) =>
  METHOD_NAMES.map((name, i) => ({
    id: `m-${i}`,
    code: `c${i}`,
    name,
    kind: (i === 0 ? "cash" : "electronic") as "cash" | "electronic",
    total: totals[i],
    count: totals[i] ? i + 1 : 0,
  }))

const register = (over: Partial<CashDay["registers"][number]>): CashDay["registers"][number] => ({
  id: UUID_T1,
  status: "closed",
  openedAt: "2026-11-10T12:58:00.000Z",
  closedAt: "2026-11-10T20:12:00.000Z",
  openedBy: { id: "p-camilo", name: "Camilo Henao" },
  closedBy: { id: "p-camilo", name: "Camilo Henao" },
  validatedBy: { id: "p-mariana", name: "Mariana Restrepo Gil" },
  validatedAt: "2026-11-10T20:20:00.000Z",
  initialCash: 200000,
  salesNet: 2318400,
  tickets: 61,
  tips: 186500,
  methods: methods([912000, 486300, 352100, 198000, 284000, 86000]),
  deposits: 50000,
  withdrawals: 120000,
  tipsPayout: 74000,
  expected: 1042000,
  countedCash: 1038500,
  cashDifference: -3500,
  closeNote: "Faltó el sencillo de una devuelta",
  ...over,
})

const DAY: CashDay = {
  date: "2026-11-10",
  status: "closed",
  registers: [
    register({}),
    register({
      id: UUID_T2,
      openedAt: "2026-11-10T20:15:00.000Z",
      closedAt: "2026-11-11T04:04:00.000Z",
      openedBy: { id: "p-daniela", name: "Daniela Ríos" },
      closedBy: { id: "p-daniela", name: "Daniela Ríos" },
      validatedBy: null,
      validatedAt: null,
      salesNet: 3902700,
      tickets: 94,
      expected: 1610200,
      countedCash: 1612200,
      cashDifference: 2000,
      closeNote: "Sobró una moneda",
    }),
  ],
  totals: {
    salesNet: 6221100,
    tickets: 155,
    avgTicket: 40136,
    tables: 48,
    deliveries: { count: 9, amount: 412000 },
    tips: 528400,
    methods: methods([2400200, 1298700, 1050400, 499000, 756800, 0]),
    deposits: 50000,
    withdrawals: 120000,
    expected: 2652200,
    counted: 2650700,
    difference: -1500,
  },
  tipsByWaiter: [
    { waiterId: "w1", name: "Valentina Cardona", amount: 162300 },
    { waiterId: "w2", name: "Andrés Felipe Osorio", amount: 141900 },
  ],
  voids: {
    count: 1,
    amount: 38000,
    items: [
      {
        at: "2026-11-10T18:24:00.000Z",
        kind: "item_void",
        orderNumber: 1046,
        table: "7",
        amount: 38000,
        reason: "dish_returned",
        reasonText: "Plato devuelto",
        requestedBy: "Valentina Cardona",
        authorizedBy: "Mariana Restrepo Gil",
      },
    ],
  },
  previous: { date: "2026-11-03", salesNet: 5874300 },
}

function renderPage(date = "2026-11-11") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onDateChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CashDayView date={date} today="2026-11-11" onDateChange={onDateChange} />
    </QueryClientProvider>,
  )
  return { onDateChange }
}

beforeEach(() => {
  api.day.mockReset().mockResolvedValue(DAY)
  api.validate.mockReset().mockResolvedValue({})
})

describe("CashDayView", () => {
  it("reads the given day and moves to the previous one", async () => {
    const { onDateChange } = renderPage()
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-11-11"))
    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }))
    expect(onDateChange).toHaveBeenCalledWith("2026-11-10")
    expect(screen.getByRole("button", { name: "Día siguiente" })).toBeDisabled()
  })

  it("shows the KPI strip with the change against the previous same weekday", async () => {
    renderPage()
    const kpis = await screen.findByRole("region", { name: "Indicadores del día" })
    expect(within(kpis).getByText("$ 6.221.100")).toBeInTheDocument()
    expect(within(kpis).getByText(/\+5,9 %/)).toBeInTheDocument()
    expect(within(kpis).getByText("155")).toBeInTheDocument()
    expect(within(kpis).getByText("$ 40.136")).toBeInTheDocument()
    expect(within(kpis).getByText("48")).toBeInTheDocument()
    expect(within(kpis).getByText(/9 domicilios/)).toBeInTheDocument()
  })

  it("shows each turno with cajero, cuadre as Faltante / Sobrante and who validated", async () => {
    renderPage()
    const t1 = await screen.findByRole("article", { name: "Turno 1 · Camilo Henao" })
    expect(within(t1).getByText("Faltante")).toBeInTheDocument()
    expect(within(t1).getByText("−$ 3.500")).toBeInTheDocument()
    expect(within(t1).getByText(/Mariana Restrepo Gil/)).toBeInTheDocument()
    expect(within(t1).getByText("Faltó el sencillo de una devuelta")).toBeInTheDocument()
    expect(within(t1).queryByRole("button", { name: "Validar turno" })).not.toBeInTheDocument()

    const t2 = screen.getByRole("article", { name: "Turno 2 · Daniela Ríos" })
    expect(within(t2).getByText("Sobrante")).toBeInTheDocument()
    expect(within(t2).getByText("+$ 2.000")).toBeInTheDocument()
  })

  it("Validar turno calls validateRegister and refreshes the day", async () => {
    renderPage()
    const t2 = await screen.findByRole("article", { name: "Turno 2 · Daniela Ríos" })
    const calls = api.day.mock.calls.length
    await act(async () => {
      fireEvent.click(within(t2).getByRole("button", { name: "Validar turno" }))
    })
    await waitFor(() => expect(api.validate).toHaveBeenCalledWith(UUID_T2))
    await waitFor(() => expect(api.day.mock.calls.length).toBeGreaterThan(calls))
  })

  it("lists every payment method (unused ones too), tips apart and voids with who authorized", async () => {
    renderPage()
    const byMethod = await screen.findByRole("region", { name: "Ventas por método de pago" })
    for (const name of METHOD_NAMES) expect(within(byMethod).getByText(name)).toBeInTheDocument()

    const tips = screen.getByRole("region", { name: "Propinas (no son ingreso del restaurante)" })
    expect(within(tips).getByText("Valentina Cardona")).toBeInTheDocument()
    expect(within(tips).getByText("$ 162.300")).toBeInTheDocument()

    const voids = screen.getByRole("region", { name: "Anulaciones y cancelaciones" })
    expect(within(voids).getByText(/Orden #1046 · Mesa 7/)).toBeInTheDocument()
    expect(within(voids).getByText("Plato devuelto")).toBeInTheDocument()
    expect(within(voids).getByText(/Autorizó Mariana Restrepo Gil/)).toBeInTheDocument()
  })

  it("explains the drawer money: fondo + efectivo + entradas − salidas − propinas = esperado", async () => {
    renderPage()
    const drawer = await screen.findByRole("region", { name: "Dinero del cajón" })
    for (const label of ["Fondo de caja", "Efectivo de ventas", "Entradas", "Salidas", "Propinas pagadas", "Esperado", "Contado", "Diferencia"]) {
      expect(within(drawer).getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it("shows an empty state for a day without turnos", async () => {
    api.day.mockResolvedValue({ ...DAY, status: "empty", registers: [], tipsByWaiter: [], voids: { count: 0, amount: 0, items: [] } })
    renderPage()
    expect(await screen.findByText("Sin movimientos este día")).toBeInTheDocument()
  })
})
