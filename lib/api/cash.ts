import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"

/**
 * The admin's Caja (caja-cierres T3, S5, S6). Every figure uses the business
 * day: a register belongs to the day of its opening in the restaurant's
 * timezone, moved back by `businessDayCutoffHour`. `GET /cash/days/{date}` is
 * the tablero, `GET /cash/days/{date}/ledger` the libro (running cash per
 * register) and `GET /cash/report` the period summary. Errors reject with
 * ApiError.
 */

type Schemas = components["schemas"]
export type CashDay = Schemas["CashDay"]
export type CashDayRegister = Schemas["CashDayRegister"]
export type CashLedger = Schemas["CashLedger"]
export type CashLedgerEntry = Schemas["CashLedgerEntry"]
export type CashReport = Schemas["CashReport"]
export type CashPeriodBucket = Schemas["CashPeriodBucket"]
export type CashReportGroup = CashReport["group"]

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
