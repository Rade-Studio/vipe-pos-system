"use client"

import { AlertTriangle, Ban } from "lucide-react"
import { segment, useScrollProgress } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

// Illustrative recipe: one burger consumes these ingredients when paid.
const recipe = [
  { name: "Pan artesanal", per: 1, stock: 30, min: 6, unit: "und" },
  { name: "Carne de res", per: 150, stock: 4500, min: 900, unit: "g" },
  { name: "Queso cheddar", per: 2, stock: 24, min: 8, unit: "lám" },
  { name: "Tomate", per: 40, stock: 1200, min: 300, unit: "g" },
]

const maxSales = 12

export function InventorySection() {
  const [ref, progress] = useScrollProgress<HTMLElement>("sticky")
  const sold = Math.round(segment(progress, 0.1, 0.85) * maxSales)
  const levels = recipe.map((item) => {
    const left = Math.max(0, item.stock - item.per * sold)
    return { ...item, left, low: left < item.min, out: left < item.per }
  })
  const soldOut = levels.some((item) => item.out)
  const lowStock = levels.filter((item) => item.low)

  return (
    <section id="inventario" ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 flex min-h-screen items-center overflow-hidden py-8 sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-6 sm:gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Inventario inteligente</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
              Vende. El inventario <span className="lp-gradient-text">se cuenta solo.</span>
            </h2>
            <p className="mt-6 hidden text-lg text-zinc-400 sm:block">
              Cada plato está vinculado a su receta. Al pagarse un pedido, el sistema descuenta los ingredientes exactos,
              registra el movimiento y te avisa cuando algo baja del mínimo. Si un ingrediente se acaba, el plato aparece
              como agotado para los meseros: nunca más vender lo que no puedes preparar.
            </p>
            <div className="mt-6 flex items-end gap-4 sm:mt-10">
              <span className="text-6xl font-semibold tabular-nums sm:text-8xl">{sold}</span>
              <span className="pb-3 text-zinc-400">hamburguesas vendidas</span>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">Hamburguesa clásica</p>
                <p className="text-sm text-zinc-500">Receta · 4 ingredientes</p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-500",
                  soldOut ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300",
                )}
              >
                {soldOut ? <Ban className="h-3.5 w-3.5" /> : null}
                {soldOut ? "Agotado" : "Disponible"}
              </span>
            </div>

            <ul className="mt-8 space-y-6">
              {levels.map((item) => (
                <li key={item.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-300">
                      {item.name}
                      <span className="ml-2 text-zinc-600">
                        −{item.per} {item.unit} por plato
                      </span>
                    </span>
                    <span className={cn("tabular-nums", item.low ? "text-amber-300" : "text-zinc-400")}>
                      {item.left.toLocaleString("es-CO")} {item.unit}
                    </span>
                  </div>
                  <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width,background-color] duration-300",
                        item.out ? "bg-rose-500" : item.low ? "bg-amber-400" : "bg-gradient-to-r from-violet-500 to-indigo-400",
                      )}
                      style={{ width: `${(item.left / item.stock) * 100}%` }}
                    />
                    <span
                      aria-hidden
                      className="absolute top-0 h-full w-px bg-white/50"
                      style={{ left: `${(item.min / item.stock) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div
              className={cn(
                "mt-8 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-all duration-500",
                lowStock.length > 0
                  ? "translate-y-0 border-amber-400/30 bg-amber-400/10 text-amber-200 opacity-100"
                  : "translate-y-3 border-transparent opacity-0",
              )}
              aria-hidden={lowStock.length === 0}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Stock bajo: {lowStock.map((item) => item.name).join(", ") || "—"}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
