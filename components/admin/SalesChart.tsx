"use client"

import type { DailySales } from "@/types"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts"
import { Panel } from "@/components/admin/common/Panel"
import { Skeleton } from "@/components/ui/skeleton"
import { compactMoney } from "@/lib/admin/compact-money"

interface SalesChartProps {
  data: DailySales[]
  isLoading?: boolean
  className?: string
}

export function SalesChart({ data, isLoading = false, className }: SalesChartProps) {
  return (
    <Panel title="Ventas diarias" description="Últimos 30 días" className={className} contentClassName="p-2 sm:p-4">
      {isLoading ? (
        <Skeleton className="h-[260px] w-full" />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ left: -8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              allowDecimals={false}
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(value: number) => compactMoney(value)}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                color: "hsl(var(--popover-foreground))",
                fontSize: 12,
              }}
              formatter={(value: number) => [`$${value.toLocaleString("es-CO")}`, "Ventas"]}
              labelFormatter={(label) => `Fecha: ${label}`}
            />
            <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  )
}
