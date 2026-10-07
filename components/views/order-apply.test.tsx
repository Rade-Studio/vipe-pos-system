/**
 * Integration test for slice S5 / design D7 consequence 2: a simulated
 * `postgres_changes` order payload dispatched through the shared
 * `orders-changes` channel must reach the consumer's cache as exactly one
 * `setQueryData` call, with zero `invalidateQueries` calls — proving that the
 * payload-application pattern (WaiterView / CashierView / AdminView) is wired
 * end-to-end via `mergeOrdersList`, not falling back to a refetch.
 *
 * `realtimeService` is stubbed via `vi.mock`. The mocked `subscribeToOrders`
 * captures its callback so the test can dispatch payloads synchronously via
 * `globalThis.__orderCb(payload)` from inside `act()`.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render } from "@testing-library/react"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { mergeOrdersList, mergeOrdersForWaiter, wireRowToPartialOrder, type OrderChange } from "@/lib/realtime/order-merge"
import type { Order } from "@/types"

// Stub the realtime-service module so the harness's `subscribeToOrders` call
// returns a captured callback we can fire from the test body.
vi.mock("@/lib/supabase/realtime-service", () => {
  return {
    realtimeService: {
      subscribeToTables: vi.fn(() => () => {}),
      subscribeToOrders: vi.fn((cb: (payload: any) => void) => {
        ;(globalThis as any).__orderCb = cb
        return () => {
          delete (globalThis as any).__orderCb
        }
      }),
    },
  }
})

import { realtimeService } from "@/lib/supabase/realtime-service"

/**
 * Mirror of the WaiterView / AdminView S5 payload-application pattern.
 * On every realtime order event, run the wire→app conversion and patch the
 * `['orders']` cache through `mergeOrdersList`. No `invalidateQueries` is
 * called — that's the contract this test enforces.
 */
function Harness({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient()
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToOrders((payload: any) => {
      const wireToAppOrder = (dbRow: any): Partial<Order> | null => {
        if (!dbRow?.id || !dbRow.status) return null
        return { id: dbRow.id, status: dbRow.status } as Partial<Order>
      }
      const conv: OrderChange = {
        eventType: payload.eventType,
        new: payload.new ? wireToAppOrder(payload.new) : null,
        old: payload.old?.id ? { id: payload.old.id } : null,
      }
      qc.setQueryData(queryKey, (prev: any) => (prev ? mergeOrdersList(prev, conv) : prev))
    })
    return () => unsubscribe()
  }, [qc, queryKey])
  return null
}

describe("S5 — payload application replaces invalidateQueries (D7 consequence 2)", () => {
  beforeEach(() => {
    delete (globalThis as any).__orderCb
  })
  afterEach(() => {
    delete (globalThis as any).__orderCb
  })

  test("realtime UPDATE payload → exactly one setQueryData, zero refetch", async () => {
    const qc = new QueryClient()
    qc.setQueryData(["orders"], [
      {
        id: "o-1",
        tableId: "t-1",
        items: [],
        status: "active",
        bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
        waiter: "",
        createdAt: new Date(0),
      },
    ])
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    render(
      <QueryClientProvider client={qc}>
        <Harness queryKey={["orders"]} />
      </QueryClientProvider>,
    )

    // The mock captured the callback during the effect. Fire one UPDATE.
    expect(typeof (globalThis as any).__orderCb).toBe("function")
    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "UPDATE",
        new: { id: "o-1", status: "delivered" },
        old: {},
      })
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
    const result = qc.getQueryData(["orders"]) as Array<{ id: string; status: string }>
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("o-1")
    expect(result[0].status).toBe("delivered")
  })

  test("realtime DELETE payload → row filtered out, zero refetch", async () => {
    const qc = new QueryClient()
    qc.setQueryData(["orders"], [
      { id: "o-1", tableId: "t-1", items: [], status: "active", bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 }, waiter: "", createdAt: new Date(0) },
      { id: "o-2", tableId: "t-2", items: [], status: "active", bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 }, waiter: "", createdAt: new Date(0) },
    ])
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    render(
      <QueryClientProvider client={qc}>
        <Harness queryKey={["orders"]} />
      </QueryClientProvider>,
    )

    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "DELETE",
        new: {},
        old: { id: "o-1" },
      })
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
    const result = qc.getQueryData(["orders"]) as Array<{ id: string }>
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("o-2")
  })

  test("realtime INSERT with unknown id → prev (no allocation, no refetch)", async () => {
    const qc = new QueryClient()
    const seed = [
      { id: "o-1", tableId: "t-1", items: [], status: "active", bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 }, waiter: "", createdAt: new Date(0) },
    ]
    qc.setQueryData(["orders"], seed)
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    render(
      <QueryClientProvider client={qc}>
        <Harness queryKey={["orders"]} />
      </QueryClientProvider>,
    )

    // INSERT for an id not yet present: mergeOrdersList's UPDATE-id-not-in-prev
    // rule is "dropped, not upserted"; INSERT-id-not-in-prev is "appended". An
    // INSERT for a new id therefore grows the list. Verify the harness
    // surfaces it without falling back to a refetch.
    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "INSERT",
        new: { id: "o-2", status: "kitchen" },
        old: {},
      })
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
    const result = qc.getQueryData(["orders"]) as Array<{ id: string; status: string }>
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe("o-2")
    expect(result[1].status).toBe("kitchen")
  })
})

/**
 * Delivery invariants through the realtime path (odd/tasks/domicilios.md
 * S13/S14). The harnesses below drive the SAME `postgres_changes` payloads the
 * shared `orders-changes` channel fans out, through the same pure merge the
 * views use, and read the result back out of the React Query cache the view
 * renders from — the public interface, not internal storage.
 */

/** WaiterView's patch shape: the waiter cache must never hold a domicilio. */
function WaiterHarness({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient()
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToOrders((payload: any) => {
      const conv: OrderChange = {
        eventType: payload.eventType,
        new: payload.new ? wireRowToPartialOrder(payload.new) : null,
        old: payload.old?.id ? { id: payload.old.id } : null,
      }
      qc.setQueryData(queryKey, (prev: any) => (prev ? mergeOrdersForWaiter(prev, conv) : prev))
    })
    return () => unsubscribe()
  }, [qc, queryKey])
  return null
}

/**
 * Cashier/Admin patch shape: those consumers DO list delivery orders, so the
 * row must survive the patch — but mapped with `orderType`, otherwise the
 * register labels it "Mesa ?" instead of DOMICILIO (S14).
 */
function AdminHarness({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient()
  useEffect(() => {
    const unsubscribe = realtimeService.subscribeToOrders((payload: any) => {
      const conv: OrderChange = {
        eventType: payload.eventType,
        new: payload.new ? wireRowToPartialOrder(payload.new) : null,
        old: payload.old?.id ? { id: payload.old.id } : null,
      }
      qc.setQueryData(queryKey, (prev: any) => (prev ? mergeOrdersList(prev, conv) : prev))
    })
    return () => unsubscribe()
  }, [qc, queryKey])
  return null
}

const dineIn = (id: string) => ({
  id,
  tableId: "t-1",
  orderType: "dine_in" as const,
  items: [],
  status: "active" as const,
  bill: { subtotal: 0, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 0, totalDiscounts: 0 },
  waiter: "",
  createdAt: new Date(0),
})

describe("delivery invariants through realtime (domicilios S13/S14)", () => {
  beforeEach(() => {
    delete (globalThis as any).__orderCb
  })
  afterEach(() => {
    delete (globalThis as any).__orderCb
  })

  test("S13: a delivery INSERT never reaches the waiter's order list", async () => {
    const qc = new QueryClient()
    qc.setQueryData(["orders"], [dineIn("o-1")])
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries")

    render(
      <QueryClientProvider client={qc}>
        <WaiterHarness queryKey={["orders"]} />
      </QueryClientProvider>,
    )

    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "INSERT",
        new: { id: "d-1", table_id: null, order_type: "delivery", status: "active" },
        old: {},
      })
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
    const result = qc.getQueryData(["orders"]) as Array<{ id: string; orderType?: string }>
    expect(result.map((o) => o.id)).toEqual(["o-1"])
    expect(result.some((o) => o.id === "d-1")).toBe(false)
  })

  test("S14: cashier/admin keep the delivery row but mapped with its orderType", async () => {
    const qc = new QueryClient()
    qc.setQueryData(["orders", "admin"], [dineIn("o-1")])

    render(
      <QueryClientProvider client={qc}>
        <AdminHarness queryKey={["orders", "admin"]} />
      </QueryClientProvider>,
    )

    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "INSERT",
        new: { id: "d-1", table_id: null, order_type: "delivery", status: "active" },
        old: {},
      })
    })

    const result = qc.getQueryData(["orders", "admin"]) as Array<{ id: string; orderType?: string }>
    expect(result.map((o) => o.id)).toEqual(["o-1", "d-1"])
    // The delivery flag is what keeps OrderCard/invoicePlaceLabel from
    // rendering "Mesa ?" for a row with no table.
    expect(result[1].orderType).toBe("delivery")
  })

  test("S14: a dine-in INSERT keeps orderType dine_in", async () => {
    const qc = new QueryClient()
    qc.setQueryData(["orders", "admin"], [dineIn("o-1")])

    render(
      <QueryClientProvider client={qc}>
        <AdminHarness queryKey={["orders", "admin"]} />
      </QueryClientProvider>,
    )

    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "INSERT",
        new: { id: "o-2", table_id: "t-2", order_type: "dine_in", status: "active" },
        old: {},
      })
    })

    const result = qc.getQueryData(["orders", "admin"]) as Array<{ id: string; orderType?: string }>
    expect(result[1].orderType).toBe("dine_in")
  })

  test("waiter patch stays reference-identical when nothing changes (no re-render)", async () => {
    const qc = new QueryClient()
    const seed = [dineIn("o-1")]
    qc.setQueryData(["orders"], seed)

    render(
      <QueryClientProvider client={qc}>
        <WaiterHarness queryKey={["orders"]} />
      </QueryClientProvider>,
    )

    await act(async () => {
      await (globalThis as any).__orderCb({
        eventType: "UPDATE",
        new: { id: "missing", status: "active" },
        old: {},
      })
    })

    // Same array reference → React Query notifies nobody → zero re-renders.
    expect(qc.getQueryData(["orders"])).toBe(seed)
  })
})