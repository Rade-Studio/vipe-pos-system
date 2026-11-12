"use client"

/**
 * S13: the bill of the cashier's orders with their discounts. The cashier
 * list already carries each order's discount records (`toCashierOrder`), so
 * an order is read again (`GET /orders/:id`) only when its records no longer
 * match its bill, e.g. after a realtime patch changed the total. After a
 * discount is added or removed the cashier list is refreshed, so the detail
 * and the payment panel charge the new total.
 */

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"

import { fetchPromotions, type PromotionDto } from "@/lib/api/catalog"
import { getById } from "@/lib/api/orders"
import { cashierOrdersQueryKey, type CashierOrder } from "@/lib/cashier/orders"
import { billInputFromCashierOrder, billInputFromDto, manualPromotions, type BillOrderInput } from "@/lib/cashier/discounts"

export const ORDER_DISCOUNTS_KEY = ["order-discounts"] as const

const billKey = (order: CashierOrder) =>
  `${order.bill.subtotal}|${order.bill.tax}|${order.bill.total}|${order.bill.totalDiscounts ?? 0}|${order.items.map((item) => `${item.id}:${item.quantity}`).join(",")}`

export function useOrderDiscounts(orders: readonly CashierOrder[]) {
  const client = useQueryClient()
  const fromList = orders.map(billInputFromCashierOrder)
  const results = useQueries({
    queries: orders.map((order, index) => ({
      queryKey: [...ORDER_DISCOUNTS_KEY, order.id, billKey(order)],
      queryFn: async () => billInputFromDto(await getById(order.id)),
      enabled: fromList[index] === null,
      retry: false,
      staleTime: 30_000,
    })),
  })
  const inputs = fromList.map((input, index) => input ?? results[index]?.data ?? null)
  const bills = inputs.every((input) => input !== null) ? (inputs as BillOrderInput[]) : null
  // S5: a failed read is shown as such (with Reintentar), never as the stale list totals.
  const failed = results.some((result, index) => fromList[index] === null && result.isError)
  const retry = useCallback(() => {
    results.forEach((result, index) => {
      if (fromList[index] === null && result.isError) void result.refetch()
    })
  }, [results, fromList])

  /** A discount changed: refresh the cashier list (new bill and records) and any order read. */
  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: cashierOrdersQueryKey }),
      client.invalidateQueries({ queryKey: ORDER_DISCOUNTS_KEY }),
    ])
  }, [client])

  return { orders: bills, refresh, isError: failed, retry }
}

/** The promotions the cashier applies by hand (GET /catalog/promotions, manual and manual_pin). */
export function useManualPromotions() {
  return useQuery<PromotionDto[]>({
    queryKey: ["catalog-promotions", "manual"],
    queryFn: async () => manualPromotions(await fetchPromotions()),
    retry: false,
    staleTime: 60_000,
  })
}
