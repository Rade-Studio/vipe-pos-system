"use client"

import { useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, Package, Trash2, TrendingDown, Truck } from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useInventoryItems, useInventoryOverview, useSuppliers } from "@/hooks/inventory"
import { PageHeader } from "@/components/admin/common/PageHeader"
import { StatCard } from "@/components/admin/common/StatCard"
import { DataTable, type DataTableColumn } from "@/components/admin/common/DataTable"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Panel, segmentedListClass, segmentedTriggerClass } from "@/components/admin/common/Panel"
import { StockStatusBadge } from "@/components/admin/stock/stock-ui"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fillSeries, reorderRows, topConsumedShares, wastePercent, type ReorderRow } from "@/lib/inventory/overview"
import { formatQuantity } from "@/lib/inventory/units"
import { formatCurrency } from "@/utils/helpers"

export const OVERVIEW_RANGES = [7, 30, 90] as const
type Range = (typeof OVERVIEW_RANGES)[number]

interface InventoryOverviewPageProps {
  description?: string
  onNavigate?: (sectionId: string) => void
}

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
}

const compactCurrency = (value: number) =>
  new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(value)

function LinkButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onClick}>
      {children}
      <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
    </Button>
  )
}

function StatValue({ isLoading, children }: { isLoading: boolean; children: ReactNode }) {
  return isLoading ? <Skeleton className="h-8 w-24" /> : <>{children}</>
}

export function InventoryOverviewPage({ description, onNavigate }: InventoryOverviewPageProps) {
  const [range, setRange] = useState<Range>(30)
  const { data: overview, isLoading } = useInventoryOverview(range)
  const { data: items = [], isLoading: isLoadingItems } = useInventoryItems()
  const { data: suppliers = [] } = useSuppliers()

  const kpis = overview?.kpis
  const series = useMemo(() => (overview ? fillSeries(overview.series, range) : []), [overview, range])
  const hasMovement = series.some((p) => p.inValue || p.outValue || p.wasteValue)
  const categories = useMemo(
    () =>
      (overview?.valueByCategory ?? [])
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((c) => ({ name: c.categoryName ?? "Sin categoría", value: c.value })),
    [overview],
  )
  const topConsumed = useMemo(() => topConsumedShares(overview?.topConsumed ?? []), [overview])
  const reorder = useMemo(() => reorderRows(items), [items])
  const supplierName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const waste = kpis ? wastePercent(kpis.wasteValue, kpis.consumptionValue) : null
  const go = (section: string) => () => onNavigate?.(section)

  const reorderColumns: DataTableColumn<ReorderRow>[] = [
    {
      id: "item",
      header: "Artículo",
      cell: ({ item }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.sku}</p>
        </div>
      ),
    },
    { id: "status", header: "Estado", cell: (row) => <StockStatusBadge status={row.status} /> },
    {
      id: "stock",
      header: "Stock / mín.",
      className: "text-right tabular-nums",
      cell: ({ item }) => `${formatQuantity(item.stock, item.unit)} / ${formatQuantity(item.minStock, item.unit)}`,
    },
    {
      id: "suggested",
      header: "Sugerido",
      className: "text-right tabular-nums",
      cell: (row) =>
        row.suggestedPurchaseUnits !== null && row.item.purchaseUnit
          ? formatQuantity(row.suggestedPurchaseUnits, row.item.purchaseUnit)
          : formatQuantity(row.suggested, row.item.unit),
    },
    {
      id: "supplier",
      header: "Proveedor",
      cell: ({ item }) =>
        (item.defaultSupplierId && supplierName.get(item.defaultSupplierId)) || (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Resumen de inventario"
        description={description}
        actions={
          <Tabs value={String(range)} onValueChange={(value) => setRange(Number(value) as Range)}>
            <TabsList className={segmentedListClass} aria-label="Rango">
              {OVERVIEW_RANGES.map((days) => (
                <TabsTrigger key={days} value={String(days)} className={segmentedTriggerClass}>
                  {days} días
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Valor del inventario"
          icon={Package}
          value={<StatValue isLoading={isLoading}>{formatCurrency(kpis?.totalValue ?? 0)}</StatValue>}
          hint={kpis ? `${kpis.activeItems} artículos activos` : undefined}
        />
        <StatCard
          title="Artículos bajo mínimo"
          icon={AlertTriangle}
          value={<StatValue isLoading={isLoading}>{kpis?.lowStockCount ?? 0}</StatValue>}
          hint={kpis ? `${kpis.outOfStockCount} agotados` : undefined}
        />
        <StatCard
          title="Por vencer"
          icon={CalendarClock}
          value={<StatValue isLoading={isLoading}>{kpis?.expiringSoonCount ?? 0}</StatValue>}
          hint={
            kpis ? (
              <button type="button" className="underline-offset-2 hover:underline" onClick={go("inventory/items")}>
                {kpis.expiredCount} vencidos · Ver artículos
              </button>
            ) : undefined
          }
        />
        <StatCard
          title="Órdenes de compra abiertas"
          icon={Truck}
          value={<StatValue isLoading={isLoading}>{kpis?.openPurchaseOrders ?? 0}</StatValue>}
          hint={kpis ? `Compras del período: ${formatCurrency(kpis.purchasesValue)}` : undefined}
        />
        <StatCard
          title="Consumo del período"
          icon={TrendingDown}
          value={<StatValue isLoading={isLoading}>{formatCurrency(kpis?.consumptionValue ?? 0)}</StatValue>}
          hint={`Últimos ${range} días`}
        />
        <StatCard
          title="Mermas del período"
          icon={Trash2}
          value={<StatValue isLoading={isLoading}>{formatCurrency(kpis?.wasteValue ?? 0)}</StatValue>}
          hint={waste === null ? "Sin consumo en el período" : `${waste.toFixed(1)}% del consumo`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="Entradas vs salidas"
          description={`Valor por día, últimos ${range} días`}
          className="lg:col-span-2"
          contentClassName="p-2 sm:p-4"
          actions={<LinkButton onClick={go("inventory/movements")}>Movimientos</LinkButton>}
        >
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : !hasMovement ? (
            <EmptyState title="Sin movimientos" description="No hubo entradas, salidas ni mermas en el período." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={series} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={compactCurrency}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatCurrency(value)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="inValue"
                  name="Entradas"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.15}
                />
                <Area
                  type="monotone"
                  dataKey="outValue"
                  name="Salidas"
                  stroke="hsl(var(--muted-foreground))"
                  fill="hsl(var(--muted-foreground))"
                  fillOpacity={0.1}
                />
                <Area
                  type="monotone"
                  dataKey="wasteValue"
                  name="Mermas"
                  stroke="hsl(var(--destructive))"
                  fill="hsl(var(--destructive))"
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel
          title="Valor por categoría"
          contentClassName="p-2 sm:p-4"
          actions={<LinkButton onClick={go("inventory/items")}>Artículos</LinkButton>}
        >
          {isLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : categories.length === 0 ? (
            <EmptyState title="Sin valor en inventario" description="Registra stock para ver el valor por categoría." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, categories.length * 36)}>
              <BarChart data={categories} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={96}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => [formatCurrency(value), "Valor"]}
                />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Reponer ahora"
          description="Artículos en o por debajo del mínimo"
          actions={
            reorder.length > 0 && (
              <Button size="sm" onClick={go("inventory/purchases")}>
                <ClipboardList className="mr-1.5 h-4 w-4" aria-hidden />
                Crear órdenes de compra
              </Button>
            )
          }
        >
          <DataTable
            rows={reorder}
            columns={reorderColumns}
            getRowId={(row) => row.item.id}
            isLoading={isLoadingItems}
            pageSize={8}
            empty={<EmptyState title="Todo en orden" description="Ningún artículo necesita reposición." />}
          />
        </Panel>

        <Panel
          title="Más consumidos"
          description={`Por valor, últimos ${range} días`}
          actions={<LinkButton onClick={go("inventory/production")}>Producción</LinkButton>}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : topConsumed.length === 0 ? (
            <EmptyState title="Sin consumo" description="No hubo consumo en el período." />
          ) : (
            <ul className="divide-y text-sm" aria-label="Más consumidos">
              {topConsumed.map((row) => (
                <li key={row.itemId} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="shrink-0 tabular-nums">{formatCurrency(row.value)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${row.share * 100}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {formatQuantity(row.quantity, row.unit, { autoScale: true })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={go("inventory/counts")}>
          Conteos físicos
        </Button>
        <Button variant="outline" size="sm" onClick={go("inventory/movements")}>
          Registrar merma o ajuste
        </Button>
      </div>
    </div>
  )
}
