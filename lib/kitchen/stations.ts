/**
 * lib/kitchen/stations.ts
 *
 * The kitchen screen of one station (F6, odd/tasks/fase3-operacion.md L10):
 * every line is stored with the station it was routed to when it was sent
 * (`stationId`), so a station that has no printer reads its comandas here.
 * "Todas" (null) is the whole board; a station sees only the orders with a
 * pending line of its own, each with only its lines, so "Listo" serves only
 * what that station cooks. Lines sent before the restaurant had stations carry
 * no station and appear only under "Todas". The choice is remembered per
 * device (localStorage).
 *
 * Pure: no React, no store.
 */
import type { Order } from "@/types"

export const KITCHEN_STATION_KEY = "vipe.kitchen.station"

type StationItem = Order["items"][number] & { stationId?: string | null }

const stationOf = (item: Order["items"][number]) => (item as StationItem).stationId ?? null

/** The order as one station sees it, or null when it has nothing pending there. */
export function orderForStation(order: Order, stationId: string | null): Order | null {
  if (stationId === null) return order
  const items = order.items.filter((item) => stationOf(item) === stationId)
  if (!items.some((item) => item.status === "kitchen")) return null
  return { ...order, items }
}

/** The board of one station; "Todas" (null) returns the same array. */
export function ordersForStation(orders: Order[], stationId: string | null): Order[] {
  if (stationId === null) return orders
  return orders.map((order) => orderForStation(order, stationId)).filter((order): order is Order => order !== null)
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

const deviceStorage = (): KeyValueStorage | undefined => (typeof window === "undefined" ? undefined : window.localStorage)

/** The station chosen on this device; null (Todas) when none or storage is unavailable. */
export function readKitchenStation(storage: KeyValueStorage | undefined = deviceStorage()): string | null {
  try {
    return storage?.getItem(KITCHEN_STATION_KEY) || null
  } catch {
    return null
  }
}

export function writeKitchenStation(stationId: string | null, storage: KeyValueStorage | undefined = deviceStorage()): void {
  try {
    if (stationId === null) storage?.removeItem(KITCHEN_STATION_KEY)
    else storage?.setItem(KITCHEN_STATION_KEY, stationId)
  } catch {
    // Private mode or a full quota: the choice lasts only for this visit.
  }
}
