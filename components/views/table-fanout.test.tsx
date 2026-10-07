import { Profiler, type ProfilerOnRenderCallback } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useShallow } from "zustand/react/shallow"

// `CompletedOrdersTable` reaches the real Supabase client transitively
// (`getOrdersByDate` from `lib/supabase/service`, and `InvoicePrintView`'s
// `lib/supabase/realtime-service` import, and `useOrderStore`'s
// `lib/supabase` barrel import) — stubbing the client at its single lowest
// level, the same way `TableManagementPanel.test.tsx` stubs the higher-level
// modules, lets every one of those resolve without a configured
// `NEXT_PUBLIC_SUPABASE_*` environment. Neither store action nor
// `InvoicePrintView.handlePrint` is exercised by this test, so no method
// stub beyond a bare object is needed.
vi.mock("@/lib/supabase/client", () => ({
  supabase: {},
  createSupabaseClient: () => ({}),
}))

import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useProfileStore } from "@/store/useProfileStore"
import { CompletedOrdersTable } from "@/components/admin/CompletedOrdersTable"

/**
 * D6 fan-out invariant (`realtime-client-sync` / "Store Writes Must Not Fan
 * Out To Unaffected Consumers"): a store write that does not change what a
 * consumer actually derives from `tables` must not re-render that consumer.
 *
 * `React.Profiler` counts commits without requiring any test-only code
 * inside the production component — the standard RTL technique for this
 * invariant (see the `onRender` callback below).
 */
function renderCounter() {
  let count = 0
  const onRender: ProfilerOnRenderCallback = () => {
    count += 1
  }
  return {
    onRender,
    get count() {
      return count
    },
  }
}

describe("D6 fan-out containment — Store Writes Must Not Fan Out To Unaffected Consumers", () => {
  beforeEach(() => {
    useTableStore.setState({
      tables: [
        { id: "t-1", number: 1, status: "available", waiter: undefined, waiter_name: undefined },
        { id: "t-2", number: 2, status: "available", waiter: undefined, waiter_name: undefined },
      ],
      activeTable: null,
    })
    useOrderStore.setState({ orders: [] })
    useProfileStore.setState({ profiles: [] })
  })

  describe("Rule A site — CompletedOrdersTable.handlePrintInvoice (no subscription)", () => {
    it("does not re-render when a table patch is applied, and still resolves the correct table via getState()", async () => {
      useOrderStore.setState({
        orders: [
          {
            id: "order-1",
            tableId: "t-1",
            items: [],
            status: "paid",
            bill: { subtotal: 100, tax: 0, taxPercentage: 0, tip: 0, tipPercentage: 0, total: 100, totalDiscounts: 0 },
            waiter: "w-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      })
      useProfileStore.setState({
        profiles: [{ id: "w-1", name: "Ana", role: "waiter", hasPassword: false }],
      })

      const probe = renderCounter()
      render(
        <Profiler id="completed-orders" onRender={probe.onRender}>
          <CompletedOrdersTable />
        </Profiler>,
      )

      const countAfterMount = probe.count
      expect(countAfterMount).toBeGreaterThan(0)

      // A table patch (even for the very table this order references) must
      // not re-render CompletedOrdersTable — Rule A dropped the hook binding,
      // so the component holds no subscription to `tables` at all.
      act(() => {
        useTableStore.getState().applyTableChange({
          eventType: "UPDATE",
          new: { id: "t-1", number: 1, status: "occupied", updated_at: "2026-01-01T00:01:00.000Z" },
        })
      })

      expect(probe.count).toBe(countAfterMount)

      // Functional correctness: the `getState()` lookup at the point of use
      // still resolves the live table — proves Rule A is not "no subscription,
      // no data", it is "no subscription, fresh read on demand".
      act(() => {
        screen.getByRole("button", { name: /Factura/i }).click()
      })

      await waitFor(() => expect(screen.getByText("Mesa:")).toBeInTheDocument())
      expect(screen.getByText("Mesa:").nextElementSibling).toHaveTextContent("1")
    })
  })

  describe("Rule B site — a narrowed `useShallow` primitive projection", () => {
    function StatusCountsProbe({ onRenderCount }: { onRenderCount: () => void }) {
      // Mirrors the exact pattern applied in AdminView.tsx (D6 Rule B): the
      // selector returns primitives only, never the `tables` array itself.
      const counts = useTableStore(
        useShallow((s) => ({
          available: s.tables.filter((t) => t.status === "available").length,
          reserved: s.tables.filter((t) => t.status === "reserved").length,
        })),
      )
      onRenderCount()
      return (
        <div>
          <span data-testid="available-count">{counts.available}</span>
          <span data-testid="reserved-count">{counts.reserved}</span>
        </div>
      )
    }

    it("does not re-render on an unrelated field change, but does re-render when a projected count changes", () => {
      let renders = 0
      render(<StatusCountsProbe onRenderCount={() => (renders += 1)} />)

      expect(renders).toBe(1)
      expect(screen.getByTestId("available-count")).toHaveTextContent("2")
      expect(screen.getByTestId("reserved-count")).toHaveTextContent("0")

      // Patch t-1's waiter only — status is unchanged, so neither projected
      // count changes. The shallow-compared projection must suppress this.
      act(() => {
        useTableStore.getState().applyTableChange({
          eventType: "UPDATE",
          new: {
            id: "t-1",
            number: 1,
            status: "available",
            waiter_id: "w-9",
            waiter_name: "Carlos",
            updated_at: "2026-01-01T00:01:00.000Z",
          },
        })
      })

      expect(renders).toBe(1)

      // Patch t-1's status — this DOES change both projected counts.
      act(() => {
        useTableStore.getState().applyTableChange({
          eventType: "UPDATE",
          new: { id: "t-1", number: 1, status: "reserved", updated_at: "2026-01-01T00:02:00.000Z" },
        })
      })

      expect(renders).toBe(2)
      expect(screen.getByTestId("available-count")).toHaveTextContent("1")
      expect(screen.getByTestId("reserved-count")).toHaveTextContent("1")
    })
  })
})
