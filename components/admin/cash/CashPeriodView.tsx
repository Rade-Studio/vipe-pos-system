"use client"

import { Fragment, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { EmptyState } from "@/components/admin/common/EmptyState"
import { Panel } from "@/components/admin/common/Panel"
import { StatCard } from "@/components/admin/common/StatCard"
import { formatAxisAmount } from "@/components/admin/SalesChart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useCashReport, useZReports } from "@/hooks/admin/use-cash"
import type { CashPeriodBucket } from "@/lib/api/cash"
import {
  DIFFERENCE_TONE_CLASS,
  PERIOD_MAX_DAYS,
  differenceStatus,
  formatCop,
  formatPercentChange,
  formatShortDay,
  formatSignedCop,
  periodRange,
  shiftDay,
  type PeriodKind,
  zNumberLabel,
} from "@/lib/admin/cash"
import { cn } from "@/lib/utils"
import { MethodTotals, WaiterTips } from "./CashDayBoard"
import { Region, Segmented } from "./Segmented"
import { usePrintZ } from "./use-print-z"

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mes" },
  { value: "range", label: "Rango" },
]

function bucketLabel(bucket: CashPeriodBucket): string {
  return bucket.start === bucket.end ? formatShortDay(bucket.start) : `${formatShortDay(bucket.start)} – ${formatShortDay(bucket.end)}`
}

/**
 * Informes Z del período (S8): one row per Z by number, and a warning row
 * where a number is missing between the first and the last.
 */
function ZReportsPanel({ range }: { range: { from: string; to: string } }) {
  const { data, isLoading, isError } = useZReports(range)
  const { reprint, printing } = usePrintZ()
  const gaps = data?.gaps ?? []
  const rows = [
    ...(data?.items ?? []).map((item) => ({ number: item.number, item })),
    ...gaps.map((number) => ({ number, item: null })),
  ].sort((a, b) => a.number - b.number)

  return (
    <Panel title="Informes Z del período" description="Numeración consecutiva: un número sin informe es un hueco que hay que revisar." contentClassName="overflow-x-auto p-0">
      {isLoading ? (
        <Skeleton className="m-4 h-16" />
      ) : isError || !data ? (
        <p className="px-4 py-3 text-sm text-destructive">No se pudieron cargar los informes Z.</p>
      ) : data.items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Sin informes Z en el período.</p>
      ) : (
        <>
          {gaps.length > 0 && (
            <p role="alert" className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {gaps.length === 1
                ? "Hay 1 número sin informe Z en la numeración del período."
                : `Hay ${gaps.length} números sin informe Z en la numeración del período.`}
            </p>
          )}
          <table aria-label="Informes Z del período" className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">N.º</th>
                <th scope="col" className="px-4 py-2 font-medium">Día</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Ventas netas</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Diferencia</th>
                <th scope="col" className="px-4 py-2 font-medium">Emitido por</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ number, item }) => (
                <Fragment key={number}>
                  {item ? (
                    <tr className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium tabular-nums">{zNumberLabel(item.number)}</td>
                      <td className="px-4 py-2">{formatShortDay(item.businessDay)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCop(item.salesNet)}</td>
                      <td className={cn("px-4 py-2 text-right tabular-nums", DIFFERENCE_TONE_CLASS[differenceStatus(item.difference).tone])}>
                        {formatSignedCop(item.difference)}
                      </td>
                      <td className="px-4 py-2">{item.emittedBy?.name ?? "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="outline"
                          className="min-h-11"
                          aria-label={`Ver / reimprimir Z ${zNumberLabel(item.number)}`}
                          disabled={printing === item.number}
                          onClick={() => void reprint(item.number)}
                        >
                          {printing === item.number && <Loader2 className="animate-spin" aria-hidden />}
                          Ver / reimprimir
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    <tr className="border-b bg-amber-50 text-amber-900 last:border-0 dark:bg-amber-950 dark:text-amber-100">
                      <td colSpan={6} className="px-4 py-2 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <AlertTriangle className="size-4 shrink-0" aria-hidden />
                          Falta el Z N.º {zNumberLabel(number)} en la numeración
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  )
}

interface CashPeriodViewProps {
  today: string
  /** A day bucket opens Día on that date. */
  onOpenDay: (date: string) => void
}

/** Resumen del período (design 04), with the informes Z of the range. */
export function CashPeriodView({ today, onOpenDay }: CashPeriodViewProps) {
  const [kind, setKind] = useState<PeriodKind>("month")
  const [custom, setCustom] = useState({ from: shiftDay(today, -29), to: today })
  const range = useMemo(() => periodRange(kind, today, custom), [kind, today, custom])
  const { data: report, isLoading, isError, refetch } = useCashReport(range)

  const chartData = useMemo(
    () => (report?.buckets ?? []).map((bucket) => ({ ...bucket, label: bucketLabel(bucket) })),
    [report],
  )
  const previousAverage = report && report.buckets.length > 0 ? report.previous.salesNet / report.buckets.length : 0
  const openBucket = (bucket: CashPeriodBucket) => {
    if (report?.group === "day") onOpenDay(bucket.start)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Segmented label="Período" value={kind} options={PERIODS} onChange={setKind} />
        {kind === "range" && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              Desde
              <Input type="date" className="h-11" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm">
              Hasta
              <Input type="date" className="h-11" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </div>
        )}
      </div>

      {range === null ? (
        <p role="alert" className="text-sm text-destructive">
          Elige un rango válido de hasta {PERIOD_MAX_DAYS} días (desde antes que hasta).
        </p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : isError || !report ? (
        <EmptyState
          title="No se pudo cargar el resumen"
          description="Revisa la conexión e intenta de nuevo."
          action={
            <Button variant="outline" className="min-h-11" onClick={() => void refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Del {formatShortDay(report.from)} al {formatShortDay(report.to)} · comparado con {formatShortDay(report.previous.start)} –{" "}
            {formatShortDay(report.previous.end)}
          </p>
          <Region label="Indicadores del período" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Ventas netas"
              value={formatCop(report.totals.salesNet)}
              hint={
                formatPercentChange(report.totals.salesNet, report.previous.salesNet)
                  ? `${formatPercentChange(report.totals.salesNet, report.previous.salesNet)} vs período anterior (${formatCop(report.previous.salesNet)})`
                  : "Sin ventas en el período anterior"
              }
            />
            <StatCard title="Tiquetes" value={report.totals.tickets} hint={`Anterior: ${report.previous.tickets}`} />
            <StatCard title="Ticket promedio" value={formatCop(report.totals.avgTicket)} hint={`Anterior: ${formatCop(report.previous.avgTicket)}`} />
            <StatCard title="Propinas" value={formatCop(report.totals.tips)} hint="No son ventas" />
            <StatCard
              title="Sobrante / faltante neto"
              value={
                <span className={DIFFERENCE_TONE_CLASS[differenceStatus(report.totals.difference).tone]}>
                  {formatSignedCop(report.totals.difference)}
                </span>
              }
              hint={`Anulaciones: ${report.totals.voids.count} por ${formatCop(report.totals.voids.amount)}`}
            />
          </Region>

          <Panel
            title="Ventas netas por día"
            description={report.group === "day" ? "Toca un día para abrir su caja. La línea es el promedio del período anterior." : "La línea es el promedio del período anterior."}
            contentClassName="p-2 sm:p-4"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={64} tickFormatter={formatAxisAmount} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value) => [formatCop(Number(value)), "Ventas netas"]}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                {previousAverage > 0 && (
                  <ReferenceLine y={previousAverage} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                )}
                <Bar
                  dataKey="salesNet"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                  className={cn(report.group === "day" && "cursor-pointer")}
                  onClick={(entry) => openBucket(entry as unknown as CashPeriodBucket)}
                />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Region label="Días del período">
            <Panel title={report.group === "day" ? "Días del período" : report.group === "week" ? "Semanas del período" : "Meses del período"}>
              <ul className="divide-y text-sm">
                {report.buckets.map((bucket) => {
                  const content = (
                    <>
                      <span className="font-medium">{bucketLabel(bucket)}</span>
                      <span className="text-muted-foreground">{bucket.tickets} tiquetes</span>
                      <span className={cn("tabular-nums", DIFFERENCE_TONE_CLASS[differenceStatus(bucket.difference).tone])}>
                        {formatSignedCop(bucket.difference)}
                      </span>
                      <span className="text-right font-medium tabular-nums">{formatCop(bucket.salesNet)}</span>
                    </>
                  )
                  const rowClass = "grid min-h-11 w-full grid-cols-2 items-center gap-x-3 py-2 text-left sm:grid-cols-4"
                  return (
                    <li key={bucket.start}>
                      {report.group === "day" ? (
                        <button
                          type="button"
                          className={cn(rowClass, "rounded-sm px-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                          onClick={() => openBucket(bucket)}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className={cn(rowClass, "px-1")}>{content}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Panel>
          </Region>

          <div className="grid gap-4 lg:grid-cols-2">
            <MethodTotals methods={report.totals.methods} salesNet={report.totals.salesNet} />
            <Region label="Sobrantes y faltantes por cajero">
              <Panel title="Sobrantes y faltantes por cajero" description="Suma del cuadre de los turnos que abrió cada cajero.">
                {report.byCashier.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin turnos en el período.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {report.byCashier.map((cashier) => {
                      const status = differenceStatus(cashier.difference)
                      return (
                        <li key={cashier.profileId} className="flex items-baseline justify-between gap-3">
                          <span>
                            <span className="font-medium">{cashier.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {cashier.shifts} {cashier.shifts === 1 ? "turno" : "turnos"}
                            </span>
                          </span>
                          <span className={cn("tabular-nums", DIFFERENCE_TONE_CLASS[status.tone])}>{formatSignedCop(cashier.difference)}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Panel>
            </Region>
            <WaiterTips tips={report.tipsByWaiter} total={report.totals.tips} />
            <Panel title="Anulaciones">
              <p className="text-sm">
                <span className="font-medium">{report.totals.voids.count}</span> anulaciones por{" "}
                <span className="font-medium tabular-nums">{formatCop(report.totals.voids.amount)}</span>
              </p>
            </Panel>
          </div>

          <ZReportsPanel range={{ from: range.from, to: range.to }} />
        </>
      )}
    </div>
  )
}
