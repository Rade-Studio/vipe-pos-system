/**
 * T9 (S1/S2) — Caja reads.
 *
 * Two facts the audit found in the admin Caja tab:
 *   - `CashRegisterSummary` kept a `useEffect` that called
 *     `refetchCashTransactions()` whenever its inner "Movimientos de Efectivo"
 *     tab became active, on top of the `useQuery` that had already fetched the
 *     same key (and `TransactionsByRegisterId` fetches that SAME key for the
 *     SAME register set). One tab click, two reads of one cache slot.
 *   - Both Caja sub-tabs loaded "registers of the selected date" on their own
 *     (`getRegistersByDate`), so opening Caja read the same day twice.
 *
 * Canonicalising the keys here is what makes both readers hit one slot, and
 * `enabled`-style gating belongs at the call site.
 */
import { describe, expect, it } from "vitest"

import {
  businessDayFor,
  cashTransactionsQueryKey,
  differenceStatus,
  formatCop,
  formatPercentChange,
  formatSignedCop,
  ledgerCsv,
  ledgerDetail,
  periodRange,
  registersByDateQueryKey,
  shiftDay,
  sortedRegisterIds,
} from "./cash"
import type { CashLedgerEntry } from "@/lib/api/cash"

describe("registersByDateQueryKey", () => {
  const day = new Date(2026, 0, 15, 18, 30)

  it("is the same slot for two pickers on the same local day", () => {
    expect(registersByDateQueryKey(day)).toEqual(registersByDateQueryKey(new Date(2026, 0, 15, 3, 5)))
  })

  it("is a different slot for another day", () => {
    expect(registersByDateQueryKey(new Date(2026, 0, 15))).not.toBe(
      registersByDateQueryKey(new Date(2026, 0, 16)),
    )
  })

  it("keeps the key serialisable (invalidate/seed from anywhere)", () => {
    for (const part of registersByDateQueryKey(day)) {
      expect(typeof part).toBe("string")
    }
  })
})

describe("sortedRegisterIds", () => {
  it("canonicalises the set so [a,b] and [b,a] share a slot", () => {
    expect(sortedRegisterIds(["b", "a"])).toEqual(["a", "b"])
    expect(sortedRegisterIds(["a", "b"])).toEqual(["a", "b"])
  })

  it("does not mutate its input", () => {
    const ids = ["b", "a"]
    sortedRegisterIds(ids)

    expect(ids).toEqual(["b", "a"])
  })
})

describe("cashTransactionsQueryKey", () => {
  it("is the same slot for both Caja readers with the same register set", () => {
    // CashRegisterSummary: ["cash-transactions-by-registers", sortedRegisters]
    // TransactionsByRegisterId: identical shape. They must not drift apart.
    expect(cashTransactionsQueryKey(["r-2", "r-1"])).toEqual(cashTransactionsQueryKey(["r-1", "r-2"]))
  })

  it("is a different slot for another register set", () => {
    expect(cashTransactionsQueryKey(["r-1"])).not.toBe(cashTransactionsQueryKey(["r-1", "r-2"]))
  })

  it("keeps an empty set addressable (the queries disable instead of firing)", () => {
    expect(cashTransactionsQueryKey([])).toEqual(cashTransactionsQueryKey([]))
  })
})
describe("businessDayFor (S5: cut-off hour)", () => {
  it("is today from the cut-off on", () => {
    expect(businessDayFor(new Date(2026, 10, 12, 4, 0), 4)).toBe("2026-11-12")
    expect(businessDayFor(new Date(2026, 10, 12, 23, 59), 4)).toBe("2026-11-12")
  })

  it("is yesterday before the cut-off (1 a.m. belongs to the previous day)", () => {
    expect(businessDayFor(new Date(2026, 10, 12, 1, 0), 4)).toBe("2026-11-11")
    expect(businessDayFor(new Date(2026, 10, 1, 3, 59), 4)).toBe("2026-10-31")
  })

  it("defaults to 4 a.m. and accepts a 0 cut-off (calendar day)", () => {
    expect(businessDayFor(new Date(2026, 10, 12, 3, 0))).toBe("2026-11-11")
    expect(businessDayFor(new Date(2026, 10, 12, 0, 30), 0)).toBe("2026-11-12")
  })
})

describe("shiftDay", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01")
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31")
  })
})

describe("periodRange", () => {
  it("Día is the business day itself", () => {
    expect(periodRange("day", "2026-11-12")).toEqual({ from: "2026-11-12", to: "2026-11-12", group: "day" })
  })

  it("Semana is Monday of the current week to today", () => {
    // 2026-11-12 is a Thursday.
    expect(periodRange("week", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-12", group: "day" })
    // A Sunday belongs to the week that started on Monday.
    expect(periodRange("week", "2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15", group: "day" })
  })

  it("Mes is the 1st of the month to today", () => {
    expect(periodRange("month", "2026-11-12")).toEqual({ from: "2026-11-01", to: "2026-11-12", group: "day" })
  })

  it("Rango keeps the chosen days, groups long ranges and refuses more than 366 days", () => {
    expect(periodRange("range", "2026-11-12", { from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      group: "day",
    })
    expect(periodRange("range", "2026-11-12", { from: "2026-01-01", to: "2026-06-30" })?.group).toBe("week")
    expect(periodRange("range", "2026-11-12", { from: "2025-11-12", to: "2026-11-12" })?.group).toBe("month")
    expect(periodRange("range", "2026-11-12", { from: "2025-11-11", to: "2026-11-12" })).toBeNull()
    expect(periodRange("range", "2026-11-12", { from: "2026-11-12", to: "2026-11-01" })).toBeNull()
  })
})

describe("differenceStatus", () => {
  it("names the cuadre with its tone", () => {
    expect(differenceStatus(0)).toEqual({ label: "Cuadra", tone: "success" })
    expect(differenceStatus(2000)).toEqual({ label: "Sobrante", tone: "warning" })
    expect(differenceStatus(-3500)).toEqual({ label: "Faltante", tone: "destructive" })
    expect(differenceStatus(null)).toEqual({ label: "Sin arqueo", tone: "muted" })
  })
})

describe("money and percent", () => {
  it("formats COP with dot thousands and no decimals", () => {
    expect(formatCop(1234567)).toBe("$ 1.234.567")
    expect(formatCop(0)).toBe("$ 0")
    expect(formatSignedCop(-3500)).toBe("−$ 3.500")
    expect(formatSignedCop(2000)).toBe("+$ 2.000")
    expect(formatSignedCop(0)).toBe("$ 0")
  })

  it("formats the change against the previous period", () => {
    expect(formatPercentChange(6221100, 5874300)).toBe("+5,9 %")
    expect(formatPercentChange(90, 100)).toBe("−10,0 %")
    expect(formatPercentChange(100, 0)).toBeNull()
  })
})

const payment: CashLedgerEntry = {
  registerId: "r1",
  at: "2026-11-10T18:24:00.000Z",
  kind: "payment",
  cashDelta: 38000,
  cashBalance: 238000,
  amount: 38000,
  orderNumber: 1046,
  table: "7",
  waiter: { id: "w1", name: "Valentina Cardona" },
  cashier: { id: "c1", name: "Camilo Henao" },
  tenders: [{ method: "Efectivo", code: "cash", kind: "cash", amount: 42000 }],
  tip: 4000,
  change: 0,
}

describe("ledgerDetail", () => {
  it("shows order number, table and waiter, never ids", () => {
    expect(ledgerDetail(payment)).toBe("Mesa 7 · Orden #1046 · Valentina Cardona")
  })

  it("shows the movement reason label and who made it", () => {
    expect(
      ledgerDetail({
        registerId: "r1",
        at: payment.at,
        kind: "cash_movement",
        cashDelta: -45000,
        cashBalance: 1,
        type: "withdrawal",
        amount: 45000,
        reason: "supplier",
        description: "Hielo",
        createdBy: { id: "c1", name: "Camilo Henao" },
      }),
    ).toBe("Pago a proveedor · Hielo · Camilo Henao")
  })
})

describe("ledgerCsv", () => {
  it("has Spanish headers and one row per entry without raw ids", () => {
    const csv = ledgerCsv([payment], () => "Turno 1 · Camilo Henao")
    const [header, row] = csv.split("\n")
    expect(header).toBe("Turno,Hora,Tipo,Detalle,Método,Propina,Valor,Saldo efectivo")
    expect(row).toContain("Mesa 7 · Orden #1046 · Valentina Cardona")
    expect(row).toContain("Cobro")
    expect(row).not.toContain("r1")
  })
})
