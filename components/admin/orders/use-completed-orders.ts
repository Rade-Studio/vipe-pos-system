"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { getOrdersByDate } from "@/lib/api/completed-orders"
import { localDayKey, startOfLocalDayMs } from "@/lib/admin/dates"
import { mergeOrderLists, paidOrdersOn } from "@/lib/admin/orders"
import { useOrderStore } from "@/store/useOrderStore"
import type { Order } from "@/types"

/** Cache slot for "the paid orders of one local day". */
export function completedOrdersQueryKey(selectedDate?: Date) {
  return ["orders", "completed", localDayKey(selectedDate)] as const
}

/**
 * The paid orders of the selected day: ONE `GET /orders/completed?date=` per
 * day (T9), merged by id with the paid orders the order store already holds,
 * newest first. Shared by the "Completadas" tab count and its table, so both
 * read the same cache slot.
 */
export function useCompletedOrders(selectedDate?: Date) {
  const storeOrders = useOrderStore((s) => s.orders)

  // T9 (S1/S2): the day's orders are a QUERY keyed on the day, not local state
  // behind a `useEffect`. `placeholderData` keeps the rows of the previous day
  // on screen while a new day loads.
  const query = useQuery<Order[]>({
    queryKey: completedOrdersQueryKey(selectedDate),
    queryFn: () => getOrdersByDate(selectedDate as Date),
    enabled: Boolean(selectedDate),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  })
  const dbOrders = query.data

  // Paid orders the order store already holds for that day, merged by id with
  // the day's query (the store list is a subset of what the query returns, and
  // a store-only paid order still shows).
  const localCompletedOrders = useMemo(() => {
    if (!selectedDate) return storeOrders.filter((order) => order.status === "paid")
    return paidOrdersOn(storeOrders, startOfLocalDayMs(selectedDate))
  }, [storeOrders, selectedDate])

  const orders = useMemo(() => {
    return [...mergeOrderLists(localCompletedOrders, dbOrders ?? [])].sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return dateB - dateA
    })
  }, [localCompletedOrders, dbOrders])

  return { ...query, orders }
}
