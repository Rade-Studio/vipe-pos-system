"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useActiveDeliveries } from "@/hooks/use-active-deliveries"
import { useZones } from "@/hooks/use-zones"
import { listCouriers } from "@/lib/api/delivery"
import { fetchLateThresholds } from "@/lib/api/settings"
import { adminOrderRows, type AdminOrderRow } from "@/lib/admin/orders"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import type { Order } from "@/types"

/**
 * A clock that ticks only while `enabled`.
 *
 * The "new order" pulse used to be `new Date() - createdAt < 30000` evaluated
 * inside the render of every card, so its answer depended on WHEN the render
 * happened: a card that rendered once inside the window kept
 * `animate-pulse-light` forever. The window (and the minutes a row shows) is
 * now a function of the data and this clock, so the class always comes back off.
 */
export function useTickingNow(enabled: boolean, intervalMs = 10_000): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNowMs(Date.now()), intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs])

  return nowMs
}

/**
 * T28 (S8): the rows of the Órdenes table, named only from stored data — the
 * shell stores (tables, waiters), the zones, the delivery board, the couriers
 * and the business-config late thresholds (same cache slot as the kitchen).
 * A failed read leaves its values empty; it never blocks the table.
 */
export function useOrderRows(orders: readonly Order[], nowMs: number): AdminOrderRow[] {
  // D6: subscribe to a primitive projection (number, zone) so a table status
  // patch does not rebuild the rows; the lookup reads getState().
  const tablesKey = useTableStore((s) =>
    s.tables.map((table) => `${table.id}:${table.number}:${table.zoneId ?? ""}`).join("|"),
  )
  const profiles = useProfileStore((s) => s.profiles)
  const { data: zones } = useZones()
  const { data: deliveries } = useActiveDeliveries()
  const { data: couriers } = useQuery({
    queryKey: ["couriers", "all"],
    queryFn: () => listCouriers({ activeOnly: false }),
    staleTime: 30_000,
    retry: false,
  })
  const { data: thresholds } = useQuery({
    queryKey: ["config", "late-thresholds"],
    queryFn: fetchLateThresholds,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return useMemo(() => {
    const tableById = new Map(useTableStore.getState().tables.map((table) => [table.id, table]))
    const zoneById = new Map((zones ?? []).map((zone) => [zone.id, zone.name]))
    const waiterById = new Map((profiles ?? []).map((profile) => [profile.id, profile.name]))
    const deliveryByOrder = new Map((deliveries ?? []).map((row) => [row.delivery.orderId, row.delivery]))
    const courierById = new Map((couriers ?? []).map((courier) => [courier.id, courier.name]))

    return adminOrderRows(orders, {
      nowMs,
      thresholds: thresholds ?? null,
      tableOf: (id) => tableById.get(id),
      zoneName: (id) => zoneById.get(id),
      waiterName: (id) => waiterById.get(id),
      deliveryOf: (orderId) => deliveryByOrder.get(orderId),
      courierName: (id) => courierById.get(id),
    })
    // tablesKey is the trigger for the getState() read.
  }, [orders, nowMs, thresholds, tablesKey, zones, profiles, deliveries, couriers])
}
