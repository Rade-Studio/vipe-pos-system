"use client"

import {TrendingUp} from "lucide-react"
import {Pie, PieChart, ResponsiveContainer} from "recharts"

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import {
    ChartConfig,
    ChartContainer, ChartLegend, ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart"

import type {PopularDish} from "@/types"

interface PopularDishesPieChartProps {
    data: PopularDish[]
}

export function PopularDishesChart({data}: PopularDishesPieChartProps) {
    if (!data || data.length === 0) {
        return (
            <Card className="col-span-2">
                <CardHeader>
                    <CardTitle>Platos Populares</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center justify-center h-[300px]">
                    <p className="text-muted-foreground">
                        No hay datos disponibles para platos populares.
                    </p>
                </CardContent>
            </Card>
        )
    }

    const sorted = [...data].sort((a, b) => b.count - a.count)
    const top5 = sorted.slice(0, 5)
    const rest = sorted.slice(5)
    const total = data.reduce((sum, item) => sum + item.count, 0)
    const otherCount = rest.reduce((sum, item) => sum + item.count, 0)

    const normalizeKey = (str: string) =>
        str.toLowerCase().replace(/\s+/g, "-")

    const chartData = [...top5]
    if (otherCount > 0) {
        chartData.push({name: "Otros", count: otherCount})
    }

    const formattedData = chartData.map((item, index) => ({
        name: item.name,
        key: normalizeKey(item.name),
        value: item.count,
        fill: `var(--chart-${index + 1})`,
    }))

    const chartConfig = formattedData.reduce(
        (acc, item, index) => ({
            ...acc,
            [item.key]: {
                label: item.name,
                color: `var(--chart-${index + 1})`,
            },
        }),
        {
            value: {label: ""},
        } as ChartConfig
    )

    return (
        <Card className="flex flex-col">
            <CardHeader className="items-center pb-0">
                <CardTitle>Platos Populares</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 pb-0">
                <ResponsiveContainer width="100%" height={300}>
                    <ChartContainer
                        config={chartConfig}
                        className="mx-auto aspect-square max-h-[100%] px-0"
                    >
                        <PieChart>
                            <ChartTooltip
                                content={<ChartTooltipContent nameKey="name"/>}
                            />
                            <Pie
                                data={formattedData}
                                dataKey="value"
                                nameKey="name"
                                labelLine={false}
                            />
                            <ChartLegend
                                content={<ChartLegendContent nameKey="key" />}
                                className="-translate-y-2 flex-wrap gap-2 *:basis-1/4 *:justify-center"
                            />
                        </PieChart>
                    </ChartContainer>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
