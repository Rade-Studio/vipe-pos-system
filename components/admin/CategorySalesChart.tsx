"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CategorySales } from "@/types"
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { useEffect } from "react"

interface CategorySalesChartProps {
  data: CategorySales[]
  categories: Record<string, string>
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"]

export function CategorySalesChart({ data, categories }: CategorySalesChartProps) {
  // Añadir logging para depuración
  useEffect(() => {
    console.log("CategorySalesChart - Datos recibidos:", data)
    console.log("CategorySalesChart - Categorías:", categories)
  }, [data, categories])

  // Verificar si hay datos
  if (!data || data.length === 0) {
    return (
      <Card className="col-span-2">
        <CardHeader>
          <CardTitle>Ventas por Categoría</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <p className="text-muted-foreground">No hay datos disponibles</p>
        </CardContent>
      </Card>
    )
  }

  // Transform data to include category names
  const transformedData = data.map((item) => ({
    ...item,
    name: categories[item.category] || `Categoría ${item.category}`,
  }))

  console.log("CategorySalesChart - Datos transformados:", transformedData)

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle>Ventas por Categoría</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={transformedData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              fill="#8884d8"
              dataKey="amount"
              nameKey="name"
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
            >
              {transformedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [`${value.toLocaleString("es-CO")}`, "Ventas"]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
