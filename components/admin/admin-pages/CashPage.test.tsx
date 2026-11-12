import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CashDay, CashPeriodBucket, CashReport, CashZList, CashZReport } from "@/lib/api/cash"

/**
 * caja-cierres T3 (S5-S6): admin Caja page. Día opens on the business day of
 * the cut-off; Período (04) shows the KPIs against the previous period, the
 * buckets, cashiers, tips and the informes Z of the range (S8). The Día content is covered in CashDayView.test.
 */

const api = vi.hoisted(() => ({
  day: vi.fn(),
  report: vi.fn(),
  zList: vi.fn(),
  zOne: vi.fn(),
  print: vi.fn(),
}))
vi.mock("@/lib/api/cash", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCashDay: api.day,
  fetchCashReport: api.report,
  fetchZReports: api.zList,
  fetchZReport: api.zOne,
}))
vi.mock("@/components/printing/slip-format", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  printSlip: api.print,
}))
vi.mock("@/lib/api/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchConfig: async () => ({ businessDayCutoffHour: 4 }),
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))

import { CashPage } from "./CashPage"

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const METHOD_NAMES = ["Efectivo", "Tarjeta débito", "Nequi"]
const methods = (totals: number[]) =>
  METHOD_NAMES.map((name, i) => ({
    id: `m-${i}`,
    code: `c${i}`,
    name,
    kind: (i === 0 ? "cash" : "electronic") as "cash" | "electronic",
    total: totals[i],
    count: totals[i] ? 1 : 0,
  }))

const DAY: CashDay = {
  z: null,
  date: "2026-11-11",
  status: "empty",
  registers: [],
  totals: {
    salesNet: 0,
    tickets: 0,
    avgTicket: 0,
    tables: 0,
    deliveries: { count: 0, amount: 0 },
    tips: 0,
    methods: methods([0, 0, 0]),
    deposits: 0,
    withdrawals: 0,
    expected: 0,
    counted: 0,
    difference: 0,
  },
  tipsByWaiter: [],
  voids: { count: 0, amount: 0, items: [] },
  previous: { date: "2026-11-04", salesNet: 0 },
}

const bucket = (start: string, salesNet: number): CashPeriodBucket => ({
  start,
  end: start,
  salesNet,
  tickets: 10,
  avgTicket: 1000,
  tips: 100,
  methods: methods([salesNet, 0, 0]),
  difference: 0,
  voids: { count: 0, amount: 0 },
})

const REPORT: CashReport = {
  from: "2026-11-01",
  to: "2026-11-11",
  group: "day",
  buckets: [bucket("2026-11-09", 5000000), bucket("2026-11-10", 6221100)],
  totals: { ...bucket("2026-11-01", 58412900), voids: { count: 3, amount: 96000 }, difference: -12300 },
  previous: bucket("2026-10-20", 54930600),
  byCashier: [
    { profileId: "p-camilo", name: "Camilo Henao", shifts: 9, difference: -9800 },
    { profileId: "p-daniela", name: "Daniela Ríos", shifts: 8, difference: 4500 },
  ],
  tipsByWaiter: [{ waiterId: "w1", name: "Valentina Cardona", amount: 1200000 }],
}

const EMITTED_BY = { id: "p-mariana", name: "Mariana Restrepo Gil" }
const zReport = (number: number, businessDay: string): CashZReport => {
  const snapshot: Partial<CashDay> = { ...DAY }
  delete snapshot.z
  return {
    number,
    businessDay,
    emittedAt: "2026-11-11T04:12:00.000Z",
    emittedBy: EMITTED_BY,
    snapshot: { ...(snapshot as Omit<CashDay, "z">), date: businessDay, taxes: { type: "INC", name: "Impuesto nacional al consumo", label: "INC (8 %)", rate: 8, base: 0, tax: 0 }, orders: { first: null, last: null }, discounts: 0, tipsByMethod: [] },
  }
}
const Z_LIST: CashZList = {
  from: "2026-11-01",
  to: "2026-11-11",
  items: [
    { number: 212, businessDay: "2026-11-08", salesNet: 5100000, difference: 0, emittedAt: "2026-11-09T04:00:00.000Z", emittedBy: EMITTED_BY },
    { number: 214, businessDay: "2026-11-10", salesNet: 6221100, difference: -1500, emittedAt: "2026-11-11T04:12:00.000Z", emittedBy: EMITTED_BY },
  ],
  gaps: [213],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CashPage description="Caja del día" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  // Thursday 12 nov 2026, 2:00 a.m.: the business day is still Wednesday 11.
  vi.setSystemTime(new Date(2026, 10, 12, 2, 0))
  api.day.mockReset().mockResolvedValue(DAY)
  api.report.mockReset().mockResolvedValue(REPORT)
  api.zList.mockReset().mockResolvedValue({ ...Z_LIST, items: [], gaps: [] })
  api.zOne.mockReset().mockImplementation(async (number: number) => zReport(number, "2026-11-10"))
  api.print.mockReset().mockReturnValue(true)
})
afterEach(() => vi.useRealTimers())

const openPeriod = () => fireEvent.click(screen.getByRole("button", { name: "Período" }))

describe("CashPage · Día", () => {
  it("opens Día on the current business day (before the 4 a.m. cut-off it is yesterday)", async () => {
    renderPage()
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-11-11"))
    expect(api.report).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }))
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-11-10"))
  })
})

describe("CashPage · Período", () => {
  it("defaults to Mes (month to date) and compares with the previous period", async () => {
    renderPage()
    openPeriod()
    await waitFor(() => expect(api.report).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-11", group: "day" }))
    const kpis = await screen.findByRole("region", { name: "Indicadores del período" })
    expect(within(kpis).getByText("$ 58.412.900")).toBeInTheDocument()
    expect(within(kpis).getByText(/\+6,3 % vs período anterior \(\$ 54\.930\.600\)/)).toBeInTheDocument()
    expect(within(kpis).getByText("−$ 12.300")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Semana" }))
    await waitFor(() => expect(api.report).toHaveBeenCalledWith({ from: "2026-11-09", to: "2026-11-11", group: "day" }))
  })

  it("lists the buckets, cashiers' differences and tips per waiter", async () => {
    renderPage()
    openPeriod()
    const days = await screen.findByRole("region", { name: "Días del período" })
    expect(within(days).getByText("$ 6.221.100")).toBeInTheDocument()
    expect(within(days).getByText("$ 5.000.000")).toBeInTheDocument()

    const cashiers = screen.getByRole("region", { name: "Sobrantes y faltantes por cajero" })
    expect(within(cashiers).getByText("Camilo Henao")).toBeInTheDocument()
    expect(within(cashiers).getByText("−$ 9.800")).toBeInTheDocument()
    expect(within(cashiers).getByText("+$ 4.500")).toBeInTheDocument()

    const tips = screen.getByRole("region", { name: "Propinas (no son ingreso del restaurante)" })
    expect(within(tips).getByText("Valentina Cardona")).toBeInTheDocument()
  })

  it("clicking a day bucket opens Día on that date", async () => {
    renderPage()
    openPeriod()
    const days = await screen.findByRole("region", { name: "Días del período" })
    fireEvent.click(within(days).getByRole("button", { name: /10 nov/ }))
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-11-10"))
  })

  it("explains a range that is too long instead of asking the API", async () => {
    renderPage()
    openPeriod()
    await waitFor(() => expect(api.report).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Rango" }))
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2025-01-01" } })
    expect(screen.getByRole("alert")).toHaveTextContent("Elige un rango válido de hasta 366 días (desde antes que hasta).")
    expect(api.report).toHaveBeenCalledTimes(2)
  })

  it("lists the Zs of the period with a warning row for a numbering gap, and reprints one", async () => {
    api.zList.mockResolvedValue(Z_LIST)
    renderPage()
    openPeriod()
    const table = await screen.findByRole("table", { name: "Informes Z del período" })
    await waitFor(() => expect(api.zList).toHaveBeenCalledWith({ from: "2026-11-01", to: "2026-11-11" }))
    const rows = within(table).getAllByRole("row").slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/000212.*8 nov.*\$ 5\.100\.000.*\$ 0.*Mariana Restrepo Gil/),
      expect.stringMatching(/Falta el Z N\.º 000213/),
      expect.stringMatching(/000214.*10 nov.*\$ 6\.221\.100.*−\$ 1\.500.*Mariana Restrepo Gil/),
    ])
    expect(screen.getByRole("alert")).toHaveTextContent("Hay 1 número sin informe Z en la numeración del período.")
    await act(async () => {
      fireEvent.click(within(rows[2]).getByRole("button", { name: "Ver / reimprimir Z 000214" }))
    })
    await waitFor(() => expect(api.zOne).toHaveBeenCalledWith(214))
    await waitFor(() => expect(api.print).toHaveBeenCalledTimes(1))
    expect(api.print.mock.calls[0][1]).toMatchObject({ title: "Informe Z N.º 000214" })
  })

  it("says so when the period has no Z", async () => {
    renderPage()
    openPeriod()
    expect(await screen.findByText("Sin informes Z en el período.")).toBeInTheDocument()
  })
})
