/**
 * T9 (S1) — the reads behind the Caja tab, in ONE cache slot per data set.
 *
 * Audit findings this module removes:
 *   - `CashRegisterSummary` kept a `useEffect` that called
 *     `refetchCashTransactions()` every time its inner "Movimientos de Efectivo"
 *     tab became active, on top of the `useQuery` that had already fetched the
 *     same key. `TransactionsByRegisterId` fetches that same key for the same
 *     register set, so opening Caja read the cash movements up to twice.
 *   - Both Caja sub-tabs loaded "registers of the selected date" on their own
 *     `useEffect` (`getRegistersByDate`), i.e. the same day read twice.
 *
 * Canonicalising both keys here is what makes the two readers share one slot,
 * so "fetch when the tab opens" (`enabled`) is enough — no refetch effect.
 */
import { CASH_MOVEMENT_REASONS } from "@/lib/api/registers"
import type { CashLedgerEntry, CashReportGroup } from "@/lib/api/cash"
import { DEFAULT_BUSINESS_DAY_CUTOFF_HOUR } from "@/lib/api/config"
import { localDayKey } from "./dates"

/**
 * Sorted copy of a register id set, so `[a, b]` and `[b, a]` are one slot.
 * Does not mutate its input.
 */
export function sortedRegisterIds(ids: readonly string[]): string[] {
  return [...ids].sort()
}

/** Cache slot for "the registers that ran on this local day". */
export function registersByDateQueryKey(date: Date | undefined): readonly string[] {
  return ["cash", "registers-by-date", localDayKey(date)]
}

/**
 * Cache slot for the cash movements of a register set (shared by both readers).
 *
 * The shape is unchanged from the key both panels already used:
 * `["cash-transactions-by-registers", <sorted ids>]`, so the two readers keep
 * hitting ONE slot.
 */
export function cashTransactionsQueryKey(
  registerIds: readonly string[],
): readonly (string | readonly string[])[] {
  return ["cash-transactions-by-registers", sortedRegisterIds(registerIds)]
}
// ---------------------------------------------------------------------------
// caja-cierres T3 (S5-S7): the admin Caja day and period views.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

function dayKeyUtc(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Business day (S5) of a local moment: before the cut-off hour it is still the
 * previous day (a turno opened at 1:00 a.m. belongs to yesterday).
 */
export function businessDayFor(now: Date, cutoffHour: number = DEFAULT_BUSINESS_DAY_CUTOFF_HOUR): string {
  const moved = new Date(now)
  moved.setHours(moved.getHours() - cutoffHour)
  return localDayKey(moved)
}

/** `YYYY-MM-DD` moved by whole days. */
export function shiftDay(day: string, delta: number): string {
  return dayKeyUtc(new Date(parseDay(day).getTime() + delta * DAY_MS))
}

/** Inclusive number of days from `from` to `to` (0 or less when reversed). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS) + 1
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** "Martes 10 nov 2026". */
export function formatBusinessDay(day: string): string {
  const date = parseDay(day)
  return `${WEEKDAYS[date.getUTCDay()]} ${formatShortDay(day)} ${date.getUTCFullYear()}`
}

/** "10 nov" for chart axes and comparisons. */
export function formatShortDay(day: string): string {
  const date = parseDay(day)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** Local clock time of an ISO instant: "3:12 p. m.". */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" })
}

export type PeriodKind = "day" | "week" | "month" | "range"
export interface PeriodRange {
  from: string
  to: string
  group: CashReportGroup
}

export const PERIOD_MAX_DAYS = 366

function groupFor(days: number): CashReportGroup {
  if (days <= 62) return "day"
  if (days <= 186) return "week"
  return "month"
}

/**
 * The report range of a Período choice: Día is the business day, Semana runs
 * from Monday, Mes from the 1st (both to today). Rango is the given days;
 * `null` when it is reversed or longer than 366 days (the API's 422).
 */
export function periodRange(
  kind: PeriodKind,
  today: string,
  custom?: { from: string; to: string },
): PeriodRange | null {
  if (kind === "day") return { from: today, to: today, group: "day" }
  if (kind === "week") {
    const weekday = (parseDay(today).getUTCDay() + 6) % 7
    return { from: shiftDay(today, -weekday), to: today, group: "day" }
  }
  if (kind === "month") return { from: `${today.slice(0, 8)}01`, to: today, group: "day" }
  if (!custom?.from || !custom.to) return null
  const days = daysBetween(custom.from, custom.to)
  if (days < 1 || days > PERIOD_MAX_DAYS) return null
  return { from: custom.from, to: custom.to, group: groupFor(days) }
}

export type DifferenceTone = "success" | "warning" | "destructive" | "muted"

/** Cuadre of a counted register: Cuadra, Sobrante (+) or Faltante (−). */
export function differenceStatus(difference: number | null | undefined): { label: string; tone: DifferenceTone } {
  if (difference === null || difference === undefined) return { label: "Sin arqueo", tone: "muted" }
  if (difference === 0) return { label: "Cuadra", tone: "success" }
  return difference > 0 ? { label: "Sobrante", tone: "warning" } : { label: "Faltante", tone: "destructive" }
}

/** Text classes per tone (status tokens of design/system.md). */
export const DIFFERENCE_TONE_CLASS: Record<DifferenceTone, string> = {
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
}

/** COP: `$ 1.234.567` (dot thousands, no decimals). */
export function formatCop(value: number): string {
  const digits = Math.round(Math.abs(value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return `${value < 0 ? "−" : ""}$ ${digits}`
}

/** COP with an explicit sign: `+$ 2.000`, `−$ 3.500`, `$ 0`. */
export function formatSignedCop(value: number): string {
  if (Math.round(value) === 0) return "$ 0"
  return value > 0 ? `+${formatCop(value)}` : formatCop(value)
}

/** "+5,9 %" against the previous period; `null` without a base. */
export function formatPercentChange(current: number, previous: number): string | null {
  if (!previous) return null
  const change = ((current - previous) / previous) * 100
  const text = Math.abs(change).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${change < 0 ? "−" : "+"}${text} %`
}


/** Label of a cash movement reason; older movements without one read "Sin motivo". */
export function movementReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Sin motivo"
  return CASH_MOVEMENT_REASONS.find((r) => r.value === reason)?.label ?? reason
}

export const LEDGER_KIND_LABEL: Record<CashLedgerEntry["kind"], string> = {
  opening: "Apertura",
  payment: "Cobro",
  cash_movement: "Movimiento",
  payment_void: "Anulación de cobro",
  order_cancellation: "Cancelación",
  close: "Cierre",
  validation: "Validación",
}

/** Tipo column: deposits and withdrawals read as Entrada / Salida. */
export function ledgerKindLabel(entry: CashLedgerEntry): string {
  if (entry.kind === "cash_movement") return entry.type === "withdrawal" ? "Salida" : "Entrada"
  return LEDGER_KIND_LABEL[entry.kind]
}

function orderPlace(entry: CashLedgerEntry): string[] {
  const parts: string[] = []
  if (entry.table) parts.push(entry.table === "Domicilio" ? "Domicilio" : `Mesa ${entry.table}`)
  if (entry.orderNumber !== null && entry.orderNumber !== undefined) parts.push(`Orden #${entry.orderNumber}`)
  return parts
}

/** Detalle column: names and numbers only, never raw ids. */
export function ledgerDetail(entry: CashLedgerEntry): string {
  switch (entry.kind) {
    case "opening":
      return ["Fondo de caja", entry.openedBy?.name].filter(Boolean).join(" · ")
    case "payment":
      return [...orderPlace(entry), entry.waiter?.name, entry.voided ? "Anulado después" : undefined]
        .filter(Boolean)
        .join(" · ")
    case "cash_movement":
      return [movementReasonLabel(entry.reason), entry.description, entry.createdBy?.name].filter(Boolean).join(" · ")
    case "payment_void":
    case "order_cancellation":
      return [
        ...orderPlace(entry),
        entry.reasonText || entry.reason,
        entry.requestedBy,
        entry.authorizedBy ? `Autorizó ${entry.authorizedBy}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    case "close":
      return ["Cerró", entry.closedBy?.name, entry.note].filter(Boolean).join(" · ")
    case "validation":
      return ["Validó", entry.validatedBy?.name].filter(Boolean).join(" · ")
  }
}

/** Método column: the tender method names of a payment. */
export function ledgerMethods(entry: CashLedgerEntry): string {
  return (entry.tenders ?? []).map((tender) => tender.method).join(" + ")
}

/** Valor column: payments and movements by amount, close by counted cash. */
export function ledgerAmount(entry: CashLedgerEntry): number | null {
  if (entry.kind === "close") return entry.counted ?? null
  if (entry.kind === "validation") return null
  const amount = entry.amount ?? null
  if (amount === null) return null
  if (entry.kind === "cash_movement" && entry.type === "withdrawal") return -amount
  if (entry.kind === "payment_void" || entry.kind === "order_cancellation") return -amount
  return amount
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Client-side CSV of the day ledger, Spanish headers, names instead of ids. */
export function ledgerCsv(entries: readonly CashLedgerEntry[], turnoLabel: (registerId: string | null) => string): string {
  const header = ["Turno", "Hora", "Tipo", "Detalle", "Método", "Propina", "Valor", "Saldo efectivo"]
  const rows = entries.map((entry) => [
    turnoLabel(entry.registerId),
    formatTime(entry.at),
    ledgerKindLabel(entry),
    ledgerDetail(entry),
    ledgerMethods(entry),
    entry.tip ?? "",
    ledgerAmount(entry) ?? "",
    entry.cashBalance ?? "",
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
}

/** Query keys of the admin Caja reads. */
export const cashDayQueryKey = (date: string) => ["cash", "day", date] as const
export const cashLedgerQueryKey = (date: string) => ["cash", "ledger", date] as const
export const cashReportQueryKey = (range: PeriodRange) => ["cash", "report", range.from, range.to, range.group] as const
