"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CategorySales } from "@/types"
import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList, ResponsiveContainer } from "recharts"
import React, { useEffect } from "react"
import { log } from "@/lib/log"

interface CategorySalesChartProps {
  data: CategorySales[]
  categories: Record<string, string>
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"]

export function CategorySalesChart({ data, categories }: CategorySalesChartProps) {
  // Añadir logging para depuración
  useEffect(() => {
    log.info("CategorySalesChart - Datos recibidos:", { data })
    log.info("CategorySalesChart - Categorías:", { categories })
  }, [data, categories])

  // Verificar si hay datos
  if (!data || data.length === 0) {
    return (
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Ventas por Categoría</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <p className="text-muted-foreground">Aún no se han registrado ventas por categoría en el período seleccionado.</p>
        </CardContent>
      </Card>
    )
  }

  // Transform data to include category names and calculate total
  const total = data.reduce((sum, item) => sum + item.amount, 0)
  const transformedData = data.map((item) => ({
    ...item,
    name: categories[item.category] || `Categoría ${item.category}`,
    percent: total > 0 ? (item.amount / total) * 100 : 0,
  }))

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Ventas por Categoría</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={transformedData}
            layout="vertical"
            margin={{ left: 40, right: 30, top: 10, bottom: 10 }}
          >
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="name" width={160} />
            <Tooltip
              formatter={(value: number, _name: string, props: any) => [
                `${value.toLocaleString("es-CO")}`,
                `Ventas (${props.payload.percent.toFixed(1)}%)`
              ]}
              labelFormatter={(label: string) => `Categoría: ${label}`}
            />
            <Bar dataKey="amount" fill="#0088FE">
              <LabelList
                dataKey="amount"
                position="right"
                formatter={(value: number, entry: any) => `${value.toLocaleString("es-CO")}\n(${entry.percent.toFixed(1)}%)`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
