"use client"

import { useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { useShallow } from "zustand/react/shallow"
import { ChefHat, DollarSign, Table2, Users } from "lucide-react"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { SalesChart } from "@/components/admin/SalesChart"
import { PopularDishesChart } from "@/components/admin/PopularDishesChart"
import { StockStatusBadge } from "@/components/admin/stock/stock-ui"
import { useInventoryItems } from "@/hooks/inventory"
import { stockAlerts } from "@/lib/inventory/overview"
import { formatQuantity } from "@/lib/inventory/units"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { StatCard } from "@/components/admin/common/StatCard"
import { Panel } from "@/components/admin/common/Panel"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/utils/helpers"
import { fetchDashboardSummary } from "@/lib/api/dashboard"
import { countOrdersByStatus, countPaidOrdersOn, type AdminOrder } from "@/lib/admin/orders"
import { DASHBOARD_DAYS, DASHBOARD_STALE_MS, dashboardSummaryKey } from "@/lib/admin/dashboard"
import { startOfLocalDayMs } from "@/lib/admin/dates"

/** Stable empty arrays: `useQuery` defaults must not be a new identity per render. */
const EMPTY_DAILY_SALES: never[] = []
const EMPTY_POPULAR_DISHES: never[] = []

interface OverviewPageProps {
  description: string
  /** The same list the Órdenes grid renders (store + admin orders query). */
  activeOrders: AdminOrder[]
  onNavigate?: (sectionId: string) => void
}

function StatValue({ isLoading, children }: { isLoading: boolean; children: ReactNode }) {
  return isLoading ? <Skeleton className="h-8 w-24" /> : <>{children}</>
}

function CountList({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([label, count]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{count}</dd>
        </div>
      ))}
    </dl>
  )
}

const STOCK_ALERT_ROWS = 5

function InventoryAlertsPanel({ onNavigate }: { onNavigate?: (sectionId: string) => void }) {
  const { data: items = [], isLoading } = useInventoryItems()
  const alerts = useMemo(() => stockAlerts(items, STOCK_ALERT_ROWS), [items])

  return (
    <Panel
      title="Alertas de inventario"
      description={
        isLoading ? "Artículos en o por debajo del stock mínimo" : `${alerts.outCount} agotados · ${alerts.lowCount} bajo mínimo`
      }
      actions={
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onNavigate?.("inventory/overview")}>
          Ver inventario
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : alerts.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún artículo necesita reposición.</p>
      ) : (
        <ul className="divide-y text-sm">
          {alerts.rows.map(({ item, status }) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-muted-foreground">
                  {formatQuantity(item.stock, item.unit)} / {formatQuantity(item.minStock, item.unit)}
                </span>
                <StockStatusBadge status={status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/**
 * Resumen. Mounted only while the section is open, so its dashboard read
 * never runs for a section nobody is looking at; it is cached and shows
 * skeletons instead of blanking the page, and an error banner instead of zeros.
 */
export function OverviewPage({ description, activeOrders, onNavigate }: OverviewPageProps) {
  // The tables / waiters numbers are NOT read here: the shell already loaded
  // both for the admin (lib/shell/startup-loads.ts). The four sales widgets
  // share ONE server-side summary (T12).
  const {
    data: summary,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: dashboardSummaryKey(DASHBOARD_DAYS),
    queryFn: () => fetchDashboardSummary(DASHBOARD_DAYS),
    staleTime: DASHBOARD_STALE_MS,
  })
  const dailySales = summary?.dailySales ?? EMPTY_DAILY_SALES
  const popularDishes = summary?.popularDishes ?? EMPTY_POPULAR_DISHES

  // D6 Rule B: render-path counts project to primitives, never to the full
  // `tables` array — see design.md D6.
  const tableStatusCounts = useTableStore(
    useShallow((s) => ({
      available: s.tables.filter((t) => t.status === "available").length,
      reserved: s.tables.filter((t) => t.status === "reserved").length,
      kitchen: s.tables.filter((t) => t.status === "kitchen").length,
      served: s.tables.filter((t) => t.status === "served").length,
      total: s.tables.length,
      assigned: s.tables.filter((t) => t.waiter).length,
    })),
  )
  const assignedTableCountByWaiter = useTableStore(
    useShallow((s) => {
      const counts: Record<string, number> = {}
      for (const t of s.tables) {
        if (t.waiter) counts[t.waiter] = (counts[t.waiter] ?? 0) + 1
      }
      return counts
    }),
  )

  const profiles = useProfileStore((s) => s.profiles)
  // "Meseros activos": the shell loads exactly `role = waiter AND active`.
  const waiters = useMemo(() => (profiles ?? []).filter((p) => p.role === "waiter"), [profiles])

  const kitchenCount = useMemo(() => countOrdersByStatus(activeOrders, ["kitchen"]), [activeOrders])
  const deliveredCount = useMemo(() => countOrdersByStatus(activeOrders, ["delivered"]), [activeOrders])
  const paidTodayCount = useMemo(
    () => countPaidOrdersOn(activeOrders, startOfLocalDayMs(new Date())),
    [activeOrders],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Resumen" description={description} />

      {isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 px-4 py-3 text-sm text-destructive"
        >
          <span>No se pudo cargar el resumen</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Ventas del Mes"
          icon={DollarSign}
          value={<StatValue isLoading={isLoading}>{summary ? formatCurrency(summary.monthSales) : "—"}</StatValue>}
          hint={new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
        />
        <StatCard
          title="Órdenes en Cocina"
          icon={ChefHat}
          value={<StatValue isLoading={isLoading}>{summary ? summary.kitchenOrders : "—"}</StatValue>}
          hint="Pendientes de preparación"
        />
        <StatCard
          title="Mesas Disponibles"
          icon={Table2}
          value={`${tableStatusCounts.available} / ${tableStatusCounts.total}`}
          hint="Listas para asignar"
        />
        <StatCard
          title="Meseros Activos"
          icon={Users}
          value={waiters.length}
          hint={`${tableStatusCounts.assigned} mesas asignadas`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SalesChart data={dailySales} isLoading={isLoading} className="lg:col-span-2" />
        <PopularDishesChart data={popularDishes} isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Estado de mesas">
          <CountList
            rows={[
              ["Disponibles", tableStatusCounts.available],
              ["Reservadas", tableStatusCounts.reserved],
              ["En cocina", tableStatusCounts.kitchen],
              ["Servidas", tableStatusCounts.served],
            ]}
          />
        </Panel>

        <Panel title="Órdenes activas">
          <CountList
            rows={[
              ["En cocina", kitchenCount],
              ["Entregadas (pendientes de pago)", deliveredCount],
              ["Completadas hoy", paidTodayCount],
            ]}
          />
        </Panel>

        <Panel title="Meseros activos" className="md:col-span-2 xl:col-span-1">
          {waiters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay meseros activos.</p>
          ) : (
            <ul className="divide-y text-sm">
              {waiters.map((waiter) => {
                const assignedTablesCount = assignedTableCountByWaiter[waiter.id] ?? 0
                return (
                  <li key={waiter.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <span className="truncate font-medium">{waiter.name}</span>
                    <Badge variant={assignedTablesCount > 0 ? "secondary" : "outline"}>
                      {assignedTablesCount > 0 ? `${assignedTablesCount} mesas` : "Disponible"}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <InventoryAlertsPanel onNavigate={onNavigate} />
    </div>
  )
}
