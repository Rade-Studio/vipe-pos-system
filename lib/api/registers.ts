import { api } from "./client"
import { ApiError } from "./errors"
import type { components } from "./schema"
import { paymentErrorOf } from "./payments"
import { localDayKey } from "@/lib/admin/dates"
import type { CashRegister, CashTransaction, PaymentMethod, PaymentTransaction } from "@/types/cash-register"

/**
 * Cash registers through the API (T9). The server stamps every timestamp
 * (opening, close, cash movements), computes the day bounds in the
 * restaurant's timezone (`?date=` is the local calendar day the user picked)
 * and enforces one open register per restaurant: a second open answers 409
 * `A register is already open`. Failures become `PaymentServiceError`, like
 * the payments module, so screens show the server message.
 */

type Schemas = components["schemas"]
type CashRegisterDto = Schemas["CashRegister"]

/** Who opened the register (always the caller at open; null before migration 0014). */
export type RegisterOpener = Schemas["ProfileRef"]
/** A register with its opener (T18); still a `CashRegister` for existing callers. */
export type CashRegisterWithOpener = CashRegister & { openedBy: RegisterOpener | null }
/** One paid order of a register, newest payment first. */
export type RegisterPaidOrder = Omit<Schemas["RegisterPaidOrder"], "paidAt"> & { paidAt: Date }

const BOTH_HISTORIES = "transactions,cashTransactions"

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw paymentErrorOf(error)
  }
}

const byId = (id: string) => ({ params: { path: { id } } })

// ---- Mapping --------------------------------------------------------------------

function toPaymentTransaction(dto: Schemas["LegacyPaymentTransaction"]): PaymentTransaction {
  return {
    id: dto.id,
    orderId: dto.orderId,
    tableId: dto.tableId ?? "",
    waiterId: dto.waiterId ?? undefined,
    amount: dto.amount,
    tipAmount: dto.tipAmount ?? undefined,
    method: dto.method as PaymentMethod,
    cashReceived: dto.cashReceived ?? undefined,
    cashChange: dto.cashChange ?? undefined,
    timestamp: new Date(dto.timestamp),
    cash_register_id: dto.cashRegisterId,
  }
}

function toCashTransaction(dto: Schemas["CashTransaction"]): CashTransaction {
  return {
    id: dto.id,
    amount: dto.amount,
    type: dto.type,
    description: dto.description,
    timestamp: new Date(dto.timestamp),
    cash_register_id: dto.cashRegisterId,
  }
}

function toRegister(dto: CashRegisterDto): CashRegisterWithOpener {
  return {
    id: dto.id,
    openingTimestamp: new Date(dto.openingTimestamp),
    closingTimestamp: dto.closingTimestamp ? new Date(dto.closingTimestamp) : undefined,
    initialCash: dto.initialCash,
    finalCash: dto.finalCash ?? undefined,
    status: dto.status,
    transactions: (dto.transactions ?? []).map(toPaymentTransaction),
    cashTransactions: (dto.cashTransactions ?? []).map(toCashTransaction),
    created_at: dto.createdAt ? new Date(dto.createdAt) : undefined,
    updated_at: dto.updatedAt ? new Date(dto.updatedAt) : undefined,
    openedBy: dto.openedBy ?? null,
  }
}

const newestFirst = <T extends { timestamp: Date }>(rows: T[]): T[] =>
  rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

// ---- Registers ----------------------------------------------------------------------

/** Opens a register; the server stamps the opening. 409 when one is already open. */
export function openRegister(initialCash: number): Promise<CashRegisterWithOpener> {
  return call(async () => {
    const { data } = await api.POST("/api/registers/open", { body: { initialCash } })
    return toRegister(required(data))
  })
}

/** The open register with both histories, or null. */
export function getCurrentRegister(): Promise<CashRegisterWithOpener | null> {
  return call(async () => {
    const { data } = await api.GET("/api/registers/current", { params: { query: { include: BOTH_HISTORIES } } })
    return data ? toRegister(data) : null
  })
}

/**
 * The open/closed check in ONE request, without the histories: the delivery
 * board and panel only need to know a register is open and its id.
 */
export function getOpenRegister(): Promise<CashRegisterWithOpener | null> {
  return call(async () => {
    const { data } = await api.GET("/api/registers/current")
    return data ? toRegister(data) : null
  })
}

/** Every register, newest opening first, with both histories. */
export function getAllRegisters(): Promise<CashRegisterWithOpener[]> {
  return call(async () => {
    const { data } = await api.GET("/api/registers", { params: { query: { include: BOTH_HISTORIES } } })
    return required(data).map(toRegister)
  })
}

/** Registers opened on that local calendar day (restaurant timezone on the server). */
export function getRegistersByDate(date: Date): Promise<CashRegisterWithOpener[]> {
  return call(async () => {
    const { data } = await api.GET("/api/registers", { params: { query: { date: localDayKey(date) } } })
    return required(data).map(toRegister)
  })
}

// ---- Paid orders ----------------------------------------------------------------------

/**
 * Paid orders of one register (pay_order payments only), newest first, with
 * number, table/zone, waiter, tip and tenders (reference included). Cashier
 * and admin only (403 -> not-authorized); the server bounds it (default 100,
 * `limit` 1..200).
 */
export function getRegisterPaidOrders(registerId: string, options: { limit?: number } = {}): Promise<RegisterPaidOrder[]> {
  const query = options.limit === undefined ? {} : { limit: options.limit }
  return call(async () => {
    const { data } = await api.GET("/api/registers/{id}/paid-orders", { params: { path: { id: registerId }, query } })
    return required(data).map((row) => ({ ...row, paidAt: new Date(row.paidAt) }))
  })
}

// ---- Cash movements -------------------------------------------------------------------

/** Deposit or withdrawal with the server clock; 409 `Register is closed`. */
export function addCashTransaction(
  registerId: string,
  amount: number,
  type: "deposit" | "withdrawal",
  description: string,
): Promise<CashTransaction> {
  return call(async () => {
    const { data } = await api.POST("/api/registers/{id}/cash-transactions", {
      ...byId(registerId),
      body: { amount, type, description },
    })
    return toCashTransaction(required(data))
  })
}

export function getCashTransactionsByRegisterId(registerId: string): Promise<CashTransaction[]> {
  return call(async () => {
    const { data } = await api.GET("/api/registers/{id}/cash-transactions", byId(registerId))
    return required(data).map(toCashTransaction)
  })
}

/** Cash movements of several registers (one request each), newest first. */
export async function getCashTransactionsByRegisters(registerIds: string[]): Promise<CashTransaction[]> {
  const lists = await Promise.all(registerIds.map(getCashTransactionsByRegisterId))
  return newestFirst(lists.flat())
}

// ---- Legacy payment_transactions --------------------------------------------------------

export function getTransactionsByRegisterId(registerId: string): Promise<PaymentTransaction[]> {
  return call(async () => {
    const { data } = await api.GET("/api/registers/{id}", {
      params: { path: { id: registerId }, query: { include: "transactions" } },
    })
    return (required(data).transactions ?? []).map(toPaymentTransaction)
  })
}

/** Legacy rows of several registers (one request each), newest first. */
export async function getTransactionsByRegisters(registerIds: string[]): Promise<PaymentTransaction[]> {
  const lists = await Promise.all(registerIds.map(getTransactionsByRegisterId))
  return newestFirst(lists.flat())
}
