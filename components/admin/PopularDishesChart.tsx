"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PopularDish } from "@/types"
import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from "recharts"
import React from "react"

interface PopularDishesChartProps {
  data: PopularDish[]
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D", "#FF6B6B"]

export function PopularDishesChart({ data }: PopularDishesChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Platos Populares</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <p className="text-muted-foreground">No hay datos disponibles para platos populares.</p>
        </CardContent>
      </Card>
    )
  }

  // Agrupar Top 5 + "Otros"
  const sorted = [...data].sort((a, b) => b.count - a.count)
  const top5 = sorted.slice(0, 5)
  const rest = sorted.slice(5)
  const total = data.reduce((sum, item) => sum + item.count, 0)
  const otherCount = rest.reduce((sum, item) => sum + item.count, 0)
  const chartData = [...top5]
  if (otherCount > 0) {
    chartData.push({ name: "Otros", count: otherCount })
  }
  // Add percent for tooltips/labels
  const chartDataWithPercent = chartData.map((item) => ({
    ...item,
    percent: total > 0 ? (item.count / total) * 100 : 0,
  }))

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Platos Populares</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartDataWithPercent} margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis allowDecimals={false} />
            <Tooltip
              formatter={(value: number, _name: string, props: any) => [
                `${value} unidades`,
                `(${props.payload.percent.toFixed(1)}%)`
              ]}
              labelFormatter={(label: string) => `Plato: ${label}`}
            />
            <Bar dataKey="count" fill="#FF8042">
              <LabelList
                dataKey="count"
                position="top"
                formatter={(value: number, entry: any) => {
                  const percent = entry && typeof entry.percent === 'number' ? entry.percent : undefined
                  return percent !== undefined
                    ? `${value} (${percent.toFixed(1)}%)`
                    : `${value}`
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
