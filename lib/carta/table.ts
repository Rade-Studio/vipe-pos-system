import type { components } from "@/lib/api/schema"
import { api } from "@/lib/api/client"
import { ApiError } from "@/lib/api/errors"
import type { CartLine } from "./cart"

/**
 * The table QR's guest calls (T4b contract, L24): status of this browser's
 * proposals, sending a proposal, the read-only bill, asking for the bill or
 * the waiter and the private feedback. From the browser, like the carta (A2).
 */

type Schemas = components["schemas"]
export type GuestTableStatus = Schemas["GuestTableStatus"]
export type GuestProposal = Schemas["GuestProposal"]
export type ProposalStage = GuestProposal["stage"]
export type GuestTableBill = Schemas["GuestTableBill"]
export type GuestBillLine = Schemas["GuestBillLine"]
export type TableRequestKind = Schemas["TableRequestRequest"]["kind"]
export type ProposalLineRequest = Schemas["ProposalLineRequest"]

/* ------------------------------------------------------------- guest key */

export function guestKeyStorageKey(slug: string): string {
  return `vipe:carta:guest:${slug}`
}

const GUEST_KEY = /^[A-Za-z0-9_-]{16,64}$/

/** 24 base64url characters (18 random bytes). */
export function newGuestKey(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(18))
  let binary = ""
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * This browser's opaque id for one restaurant, created once and kept in
 * localStorage; the status shows only its own proposals. Without storage
 * (private mode) it lives for the visit.
 */
export function guestKeyFor(storage: Pick<Storage, "getItem" | "setItem"> | undefined, slug: string): string {
  try {
    const stored = storage?.getItem(guestKeyStorageKey(slug))
    if (stored && GUEST_KEY.test(stored)) return stored
  } catch {
    // Unreadable storage: a fresh key for this visit.
  }
  const key = newGuestKey()
  try {
    storage?.setItem(guestKeyStorageKey(slug), key)
  } catch {
    // Private mode or a full quota.
  }
  return key
}

/* ----------------------------------------------------------------- calls */

interface TableRef {
  slug: string
  token: string
}

const path = ({ slug, token }: TableRef) => ({ path: { slug, token } })

function required<T>(data: T | undefined): T {
  if (data === undefined) throw new ApiError(500, "Internal Server Error", "Empty API response")
  return data
}

export async function fetchTableStatus(table: TableRef, guestKey: string): Promise<GuestTableStatus> {
  const { data } = await api.GET("/api/carta/{slug}/m/{token}/status", { params: { ...path(table), query: { guestKey } } })
  return required(data)
}

/** The cart as the API's proposal lines: one line per cart line, options by id. */
export function proposalItems(lines: readonly CartLine[]): ProposalLineRequest[] {
  return lines.map((l) => ({
    dishId: l.dishId,
    quantity: l.qty,
    ...(l.options.length ? { optionIds: l.options.map((o) => o.optionId) } : {}),
    ...(l.note ? { note: l.note } : {}),
  }))
}

export async function sendProposal(table: TableRef, guestKey: string, lines: readonly CartLine[], note: string) {
  const trimmed = note.trim()
  const { data } = await api.POST("/api/carta/{slug}/m/{token}/proposals", {
    params: path(table),
    body: { guestKey, items: proposalItems(lines), ...(trimmed ? { note: trimmed } : {}) },
  })
  return required(data)
}

/** Null when the table is closed or the bill is hidden (404). */
export async function fetchTableBill(table: TableRef): Promise<GuestTableBill | null> {
  try {
    const { data } = await api.GET("/api/carta/{slug}/m/{token}/bill", { params: path(table) })
    return required(data)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function sendTableRequest(table: TableRef, kind: TableRequestKind) {
  const { data } = await api.POST("/api/carta/{slug}/m/{token}/requests", { params: path(table), body: { kind } })
  return required(data)
}

export async function sendFeedback(slug: string, body: { token?: string; rating: number; comment?: string | null }): Promise<void> {
  const comment = body.comment?.trim()
  await api.POST("/api/carta/{slug}/feedback", {
    params: { path: { slug } },
    body: { ...(body.token ? { token: body.token } : {}), rating: body.rating, ...(comment ? { comment } : {}) },
  })
}

/** The API's own Spanish answer (409/422/429), else a generic one. */
export function guestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && [404, 409, 422, 429].includes(error.status)) return error.message
  return fallback
}

/* ------------------------------------------------------------ bill split */

export const MAX_PEOPLE = 20
export const MAX_SHARE = 12

export type BillSplit = { mode: "equal"; people: number } | { mode: "lines"; shares: Record<number, number> }

/**
 * S13 "Es una guía": the diner's part. Equal = the table total over the
 * people; by line = each checked line's total over the people sharing it,
 * with the bill's discounts spread in proportion. The tip is on the part.
 */
export function billShare(bill: GuestTableBill, split: BillSplit, tipOn: boolean, tipPercentage: number) {
  let part: number
  if (split.mode === "equal") {
    part = bill.subtotal / Math.max(1, split.people)
  } else {
    const gross = bill.lines.reduce((sum, l, i) => sum + (split.shares[i] ? l.lineTotal / split.shares[i] : 0), 0)
    const ratio = bill.grossSubtotal > 0 ? bill.subtotal / bill.grossSubtotal : 1
    part = gross * ratio
  }
  const tip = tipOn ? Math.round((part * tipPercentage) / 100) : 0
  return { part, tip, total: Math.round(part + tip) }
}

/** The status every proposal card shows, in the artboard's order. */
export const STAGE_STEP: Record<ProposalStage, number> = {
  pending: 0,
  confirmed: 1,
  kitchen: 2,
  served: 3,
  rejected: -1,
  cancelled: -1,
}
