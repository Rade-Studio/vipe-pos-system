import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * The admin's Caja (caja-cierres T3, S5-S7). Every figure uses the business
 * day: a register belongs to the day of its opening in the restaurant's
 * timezone, moved back by `businessDayCutoffHour`. `GET /cash/days/{date}` is
 * the tablero, `GET /cash/days/{date}/ledger` the libro (running cash per
 * register), `GET /cash/report` the period summary, and
 * `POST /registers/{id}/validate` is "Validar turno" (admin; 409 while open,
 * a second call returns the stored validation). `POST /cash/days/{date}/z`
 * emits the day's informe Z (S8: admin; 409 day_open / day_empty; a second
 * emit returns the stored Z), `GET /cash/z` lists the Zs of a range with the
 * gaps in the numbering and `GET /cash/z/{number}` reads one to reprint it.
 * Errors reject with ApiError.
 */

type Schemas = components["schemas"]
export type CashDay = Schemas["CashDay"]
export type CashDayRegister = Schemas["CashDayRegister"]
export type CashLedger = Schemas["CashLedger"]
export type CashLedgerEntry = Schemas["CashLedgerEntry"]
export type CashReport = Schemas["CashReport"]
export type CashPeriodBucket = Schemas["CashPeriodBucket"]
export type CashReportGroup = CashReport["group"]
export type ValidatedRegister = Schemas["CashRegister"]
export type CashZRef = Schemas["CashZRef"]
export type CashZReport = Schemas["CashZReport"]
export type CashZList = Schemas["CashZList"]
export type CashZListItem = Schemas["CashZListItem"]

/** The server refuses longer ranges (422 range_too_long). */
export const REPORT_MAX_DAYS = 366

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function fetchCashDay(date: string): Promise<CashDay> {
  const { data } = await api.GET("/api/cash/days/{date}", { params: { path: { date } } })
  return required(data)
}

export async function fetchCashLedger(date: string): Promise<CashLedger> {
  const { data } = await api.GET("/api/cash/days/{date}/ledger", { params: { path: { date } } })
  return required(data)
}

export async function fetchCashReport(query: { from: string; to: string; group: CashReportGroup }): Promise<CashReport> {
  const { data } = await api.GET("/api/cash/report", { params: { query } })
  return required(data)
}

export async function validateRegister(id: string): Promise<ValidatedRegister> {
  const { data } = await api.POST("/api/registers/{id}/validate", { params: { path: { id } } })
  return required(data)
}

export async function emitZReport(date: string): Promise<CashZReport> {
  const { data } = await api.POST("/api/cash/days/{date}/z", { params: { path: { date } } })
  return required(data)
}

export async function fetchZReports(query: { from: string; to: string }): Promise<CashZList> {
  const { data } = await api.GET("/api/cash/z", { params: { query } })
  return required(data)
}

export async function fetchZReport(number: number): Promise<CashZReport> {
  const { data } = await api.GET("/api/cash/z/{number}", { params: { path: { number } } })
  return required(data)
}
