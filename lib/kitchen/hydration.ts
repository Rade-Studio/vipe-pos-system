/**
 * lib/kitchen/hydration.ts
 *
 * Kitchen queue merge rules (T7, odd/tasks/cargas-por-perfil.md S1/S2).
 *
 * The queue used to be hydrated with `setOrders([])` followed by one
 * `addOrder` per order: the board blanked on every refetch and every card was a
 * new element. These helpers replace the queue in ONE store write while
 * keeping the reference of every order whose content did not change, so an
 * unchanged card keeps its identity and a no-op refetch re-renders nothing.
 *
 * The same "keep what did not change" rule applies to the new-item highlights:
 * a refresh must not wipe the "¡Nuevos productos agregados!" markers of the
 * items that just arrived, but it must drop the ones of orders that left.
 *
 * Pure: no Supabase, no React, no store. The view passes plain arrays.
 */
import type { Order, OrderBill, OrderItem } from "@/types"

function sameItem(a: OrderItem, b: OrderItem): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.price === b.price &&
    a.quantity === b.quantity &&
    a.status === b.status &&
    (a.comments ?? undefined) === (b.comments ?? undefined) &&
    (a.addedAt?.getTime() ?? null) === (b.addedAt?.getTime() ?? null)
  )
}

function sameBill(a: OrderBill | undefined, b: OrderBill | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.subtotal === b.subtotal &&
    a.tax === b.tax &&
    a.taxPercentage === b.taxPercentage &&
    a.tip === b.tip &&
    a.tipPercentage === b.tipPercentage &&
    a.total === b.total &&
    a.totalDiscounts === b.totalDiscounts
  )
}

function sameItems(a: readonly OrderItem[] | undefined, b: readonly OrderItem[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((item, index) => sameItem(item, b[index]))
}

/**
 * Content equality, not reference equality: a refetch always hands back fresh
 * objects, and only a real content difference may replace a row.
 */
export function sameKitchenOrder(a: Order, b: Order): boolean {
  return (
    a.id === b.id &&
    a.tableId === b.tableId &&
    a.orderType === b.orderType &&
    a.status === b.status &&
    a.waiter === b.waiter &&
    (a.isPartialOrder ?? false) === (b.isPartialOrder ?? false) &&
    a.parentOrderId === b.parentOrderId &&
    (a.paymentMethod ?? undefined) === (b.paymentMethod ?? undefined) &&
    (a.createdAt?.getTime() ?? null) === (b.createdAt?.getTime() ?? null) &&
    sameItems(a.items, b.items) &&
    sameBill(a.bill, b.bill)
  )
}

/**
 * Replace the queue with `next` while keeping the identity of every order
 * whose content is unchanged. Returns the IDENTICAL `prev` array when nothing
 * changed, so callers can pass the result straight to a store setter and a
 * no-op refetch notifies nobody.
 */
export function mergeKitchenOrders(prev: readonly Order[], next: readonly Order[]): Order[] {
  const prevById = new Map(prev.map((order) => [order.id, order]))
  const merged: Order[] = []
  let changed = next.length !== prev.length

  for (const order of next) {
    const existing = prevById.get(order.id)
    if (existing !== undefined && sameKitchenOrder(existing, order)) {
      merged.push(existing)
    } else {
      merged.push(order)
      changed = true
    }
  }

  if (!changed) {
    for (let index = 0; index < merged.length; index += 1) {
      if (merged[index] !== prev[index]) {
        changed = true
        break
      }
    }
  }

  return changed ? merged : (prev as Order[])
}

/** orderId -> item ids that must render as "new". */
export type NewItemsMap = Record<string, string[]>

/** Drop the highlights of orders a refresh no longer returns; keep the rest. */
export function mergeNewItems(prev: NewItemsMap, orderIds: readonly string[]): NewItemsMap {
  const kept = new Set(orderIds)
  const entries = Object.entries(prev).filter(([orderId]) => kept.has(orderId))
  if (entries.length === Object.keys(prev).length) return prev
  return Object.fromEntries(entries)
}

/** Highlight items that just arrived, once each, never touching other orders. */
export function addNewItems(prev: NewItemsMap, orderId: string, itemIds: readonly string[]): NewItemsMap {
  const current = prev[orderId] ?? []
  const merged = [...current]
  for (const itemId of itemIds) {
    if (!merged.includes(itemId)) merged.push(itemId)
  }
  if (merged.length === current.length) return prev
  return { ...prev, [orderId]: merged }
}

/** Forget served items; drop the order entry when nothing is highlighted. */
export function removeNewItems(prev: NewItemsMap, orderId: string, itemIds: readonly string[]): NewItemsMap {
  const current = prev[orderId]
  if (!current) return prev
  const remaining = current.filter((itemId) => !itemIds.includes(itemId))
  if (remaining.length === current.length) return prev
  const next = { ...prev }
  if (remaining.length === 0) {
    delete next[orderId]
  } else {
    next[orderId] = remaining
  }
  return next
}

/** Forget everything highlighted for an order that left the queue. */
export function dropNewItems(prev: NewItemsMap, orderId: string): NewItemsMap {
  if (!(orderId in prev)) return prev
  const next = { ...prev }
  delete next[orderId]
  return next
}