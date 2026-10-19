"use client"

import { Pie, PieChart } from "recharts"
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Panel } from "@/components/admin/common/Panel"
import { Skeleton } from "@/components/ui/skeleton"
import type { PopularDish } from "@/types"

interface PopularDishesPieChartProps {
  data: PopularDish[]
  isLoading?: boolean
  className?: string
}

/** Darkest shades of the theme chart ramp first, so the top dish stands out. */
const SLICE_COLORS = [8, 7, 6, 5, 4, 3].map((n) => `var(--chart-${n})`)

const normalizeKey = (str: string) => str.toLowerCase().replace(/\s+/g, "-")

export function PopularDishesChart({ data, isLoading = false, className }: PopularDishesPieChartProps) {
  const sorted = [...(data ?? [])].sort((a, b) => b.count - a.count)
  const top5 = sorted.slice(0, 5)
  const otherCount = sorted.slice(5).reduce((sum, item) => sum + item.count, 0)

  const chartData = [...top5]
  if (otherCount > 0) {
    chartData.push({ name: "Otros", count: otherCount })
  }

  const formattedData = chartData.map((item, index) => ({
    name: item.name,
    key: normalizeKey(item.name),
    value: item.count,
    fill: SLICE_COLORS[index],
  }))

  const chartConfig = formattedData.reduce(
    (acc, item, index) => ({
      ...acc,
      [item.key]: { label: item.name, color: SLICE_COLORS[index] },
    }),
    { value: { label: "" } } as ChartConfig,
  )

  return (
    <Panel title="Platos populares" description="Últimos 30 días" className={className}>
      {isLoading ? (
        <Skeleton className="mx-auto aspect-square h-[240px] rounded-full" />
      ) : formattedData.length === 0 ? (
        <p className="flex h-[240px] items-center justify-center text-center text-sm text-muted-foreground">
          No hay datos disponibles para platos populares.
        </p>
      ) : (
        <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[280px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie data={formattedData} dataKey="value" nameKey="name" innerRadius="45%" strokeWidth={2} />
            <ChartLegend
              content={<ChartLegendContent nameKey="key" />}
              className="-translate-y-2 flex-wrap gap-2 *:basis-1/3 *:justify-center"
            />
          </PieChart>
        </ChartContainer>
      )}
    </Panel>
  )
}
