"use client"

import { useMemo, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import type { PopularDish } from "@/types"
import { cn } from "@/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useShallow } from "zustand/react/shallow"
import { ChefHat, DollarSign, Table2, Users } from "lucide-react"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { SalesChart } from "@/components/admin/SalesChart"
import { StockStatusBadge } from "@/components/admin/stock/stock-ui"
import { useInventoryItems } from "@/hooks/inventory"
import { stockAlerts } from "@/lib/inventory/overview"
import { formatQuantity } from "@/lib/inventory/units"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { Panel } from "@/components/admin/common/Panel"
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

/** Redesign card on the canvas (design/system.md · Card); Panel keeps its header layout. */
const CARD_CLASS = "rounded-card-lg border-line bg-surface shadow-none dark:backdrop-blur-xl [&>div:first-child]:border-line"
const CHIP_CLASS = "inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-[11.5px] font-medium tabular-nums"

function KpiCard({ title, value, hint, icon: Icon }: { title: string; value: ReactNode; hint: ReactNode; icon: LucideIcon }) {
  return (
    <div className={cn("min-w-0 rounded-card-lg border border-line bg-surface p-4 text-fg md:p-5 dark:backdrop-blur-xl")}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11.5px] uppercase tracking-[0.08em] text-muted-fg">{title}</p>
        <Icon className="h-4 w-4 shrink-0 text-brand-strong" aria-hidden />
      </div>
      <div className="mb-0.5 mt-1.5 truncate text-[clamp(17px,4vw,28px)] font-semibold tabular-nums leading-tight">{value}</div>
      <p className="text-[12.5px] text-muted-fg">{hint}</p>
    </div>
  )
}

const TOP_DISHES = 5

function TopDishesPanel({ data, isLoading }: { data: PopularDish[]; isLoading: boolean }) {
  const top = useMemo(() => [...data].sort((a, b) => b.count - a.count).slice(0, TOP_DISHES), [data])
  const max = top[0]?.count || 1

  return (
    <Panel title="Platos más vendidos" description="Últimos 30 días" className={CARD_CLASS}>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="text-sm text-muted-fg">Todavía no hay ventas en los últimos 30 días.</p>
      ) : (
        <ul aria-label="Platos más vendidos" className="divide-y divide-line text-sm">
          {top.map((dish) => (
            <li key={dish.name} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 truncate" title={dish.name}>
                {dish.name}
              </span>
              <span aria-hidden className="h-2 w-[72px] shrink-0 overflow-hidden rounded-full border border-line bg-surface-2">
                <i className="block h-full bg-brand" style={{ width: `${(dish.count / max) * 100}%` }} />
              </span>
              <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-fg-2">{dish.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  )
}

function StatValue({ isLoading, children }: { isLoading: boolean; children: ReactNode }) {
  return isLoading ? <Skeleton className="h-8 w-24" /> : <>{children}</>
}

function CountList({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {rows.map(([label, count]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <dt className="min-w-0 text-muted-fg">{label}</dt>
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
      className={CARD_CLASS}
      title="Alertas de inventario"
      description={
        isLoading ? "Artículos en o por debajo del stock mínimo" : `${alerts.outCount} agotados · ${alerts.lowCount} bajo mínimo`
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full border-line-strong bg-transparent px-3.5"
          onClick={() => onNavigate?.("inventory/overview")}
        >
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
        <p className="text-sm text-muted-fg">Ningún artículo necesita reposición.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {alerts.rows.map(({ item, status }) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-[13px] tabular-nums text-fg-2">
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
    <div className="flex min-w-0 flex-col gap-5 md:gap-6">
      <PageHeader title="Resumen" description={description} />

      {isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-status-danger-line bg-status-danger-bg px-4 py-3 text-sm text-status-danger-fg"
        >
          <span>No se pudo cargar el resumen</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
        <KpiCard
          title="Ventas del Mes"
          icon={DollarSign}
          value={<StatValue isLoading={isLoading}>{summary ? formatCurrency(summary.monthSales) : "—"}</StatValue>}
          hint={new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
        />
        <KpiCard
          title="Órdenes en Cocina"
          icon={ChefHat}
          value={<StatValue isLoading={isLoading}>{summary ? summary.kitchenOrders : "—"}</StatValue>}
          hint="Pendientes de preparación"
        />
        <KpiCard
          title="Mesas Disponibles"
          icon={Table2}
          value={`${tableStatusCounts.available} / ${tableStatusCounts.total}`}
          hint="Listas para asignar"
        />
        <KpiCard
          title="Meseros Activos"
          icon={Users}
          value={waiters.length}
          hint={`${tableStatusCounts.assigned} mesas asignadas`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SalesChart data={dailySales} isLoading={isLoading} className={cn(CARD_CLASS, "lg:col-span-2")} />
        <TopDishesPanel data={popularDishes} isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Estado de mesas" className={CARD_CLASS}>
          <CountList
            rows={[
              ["Disponibles", tableStatusCounts.available],
              ["Reservadas", tableStatusCounts.reserved],
              ["En cocina", tableStatusCounts.kitchen],
              ["Servidas", tableStatusCounts.served],
            ]}
          />
        </Panel>

        <Panel title="Órdenes activas" className={CARD_CLASS}>
          <CountList
            rows={[
              ["En cocina", kitchenCount],
              ["Entregadas (pendientes de pago)", deliveredCount],
              ["Completadas hoy", paidTodayCount],
            ]}
          />
        </Panel>

        <Panel
          title="Meseros activos"
          description={`${waiters.length} activos · ${tableStatusCounts.assigned} mesas`}
          className={cn(CARD_CLASS, "md:col-span-2 xl:col-span-1")}
        >
          {waiters.length === 0 ? (
            <p className="text-sm text-muted-fg">No hay meseros activos.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {waiters.map((waiter) => {
                const assignedTablesCount = assignedTableCountByWaiter[waiter.id] ?? 0
                return (
                  <li key={waiter.id} className="flex min-w-0 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full border border-brand-line bg-brand-tint text-xs font-semibold text-brand-strong"
                    >
                      {initials(waiter.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={waiter.name}>
                      {waiter.name}
                    </span>
                    <span
                      className={cn(
                        CHIP_CLASS,
                        assignedTablesCount > 0
                          ? "border-status-occupied-line bg-status-occupied-bg text-status-occupied-fg"
                          : "border-status-free-line bg-status-free-bg text-status-free-fg",
                      )}
                    >
                      {assignedTablesCount > 0 ? `${assignedTablesCount} mesas` : "Disponible"}
                    </span>
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
