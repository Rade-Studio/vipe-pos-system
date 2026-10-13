"use client"

import { Bike, Check, Store, MapPin } from "lucide-react"
import { deliveryFeatures, deliverySteps } from "@/components/landing/content"
import { Reveal, SplitWords, segment, useScrollProgress } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

// Route drawn on a 400x260 illustrative map, from the restaurant to the customer.
const route: [number, number][] = [
  [52, 214],
  [52, 146],
  [176, 146],
  [176, 74],
  [296, 74],
  [348, 44],
]
const routePath = `M ${route.map(([x, y]) => `${x} ${y}`).join(" L ")}`

const segments = route.slice(1).map(([x, y], index) => {
  const [px, py] = route[index]
  return Math.hypot(x - px, y - py)
})
const routeLength = segments.reduce((sum, length) => sum + length, 0)

function pointOnRoute(progress: number): [number, number] {
  let remaining = progress * routeLength
  for (let index = 0; index < segments.length; index++) {
    if (remaining <= segments[index] || index === segments.length - 1) {
      const t = Math.min(1, remaining / segments[index])
      const [ax, ay] = route[index]
      const [bx, by] = route[index + 1]
      return [ax + (bx - ax) * t, ay + (by - ay) * t]
    }
    remaining -= segments[index]
  }
  return route[route.length - 1]
}

// City blocks for the map background.
const blocks = [
  [70, 160, 90, 70], [70, 90, 90, 40], [70, 20, 90, 54], [194, 160, 84, 70], [194, 90, 84, 40],
  [194, 20, 84, 38], [296, 90, 90, 140], [10, 20, 26, 210],
]

const elapsedByStep = ["hace un momento", "hace 6 min", "hace 14 min", "hace 18 min", "hace 31 min"]

export function DeliverySection() {
  const [ref, progress] = useScrollProgress<HTMLDivElement>("sticky")
  const travel = segment(progress, 0.06, 0.94)
  const active = Math.min(deliverySteps.length - 1, Math.floor(travel * deliverySteps.length * 0.999))
  // The courier only moves while the order is "En camino" (fourth step).
  const ride = segment(travel, 3 / deliverySteps.length, 4 / deliverySteps.length - 0.03)
  const [bikeX, bikeY] = pointOnRoute(ride)
  const delivered = active === deliverySteps.length - 1

  return (
    <section id="domicilios" data-testid="delivery" className="relative">
      <div className="mx-auto max-w-6xl px-6 pt-32">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-end">
          <div>
            <Reveal>
              <p className="text-sm uppercase tracking-[0.3em] text-fuchsia-300">Módulo de domicilios</p>
            </Reveal>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
              <SplitWords text="Tus domicilios," />{" "}
              <SplitWords text="bajo control." className="lp-gradient-text" delay={200} />
            </h2>
            <Reveal delay={250}>
              <p className="mt-6 max-w-xl text-lg text-zinc-400">
                El salón y los domicilios en el mismo sistema: un rol dedicado para tomar y despachar pedidos, la
                comanda llega a cocina marcada como domicilio y el cobro termina en la misma caja.
              </p>
            </Reveal>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {deliveryFeatures.map((feature, index) => (
              <Reveal key={feature} as="li" delay={index * 70} variant="right" className="flex items-start gap-3 text-zinc-300">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-fuchsia-300" />
                {feature}
              </Reveal>
            ))}
          </ul>
        </div>
      </div>

      <div ref={ref} className="relative h-[320vh]">
        <div className="sticky top-0 flex min-h-screen items-center overflow-hidden py-8">
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(217,70,239,0.14),transparent_65%)]" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 p-3">
              <svg viewBox="0 0 400 240" className="h-auto w-full" role="img" aria-label="Recorrido del domicilio">
                {blocks.map(([x, y, w, h], index) => (
                  <rect key={index} x={x} y={y} width={w} height={h} rx={6} className="fill-white/[0.04] stroke-white/[0.06]" />
                ))}
                <path d={routePath} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={4} strokeDasharray="2 8" strokeLinecap="round" />
                <path
                  d={routePath}
                  pathLength={1}
                  fill="none"
                  stroke="url(#lp-route)"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1 1"
                  strokeDashoffset={1 - ride}
                />
                <defs>
                  <linearGradient id="lp-route" x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#f0abfc" />
                  </linearGradient>
                </defs>
                <g transform={`translate(${route[0][0]} ${route[0][1]})`}>
                  <circle r={14} className="fill-violet-500/20 stroke-violet-400/60" />
                  <Store x={-7} y={-7} width={14} height={14} className="text-violet-200" />
                </g>
                <g transform={`translate(${route[route.length - 1][0]} ${route[route.length - 1][1]})`}>
                  <circle r={delivered ? 18 : 14} className={cn("transition-all duration-500", delivered ? "fill-emerald-500/30 stroke-emerald-300" : "fill-fuchsia-500/20 stroke-fuchsia-400/60")} />
                  <MapPin x={-7} y={-7} width={14} height={14} className={delivered ? "text-emerald-200" : "text-fuchsia-200"} />
                </g>
                <g transform={`translate(${bikeX} ${bikeY})`} style={{ opacity: active >= 3 ? 1 : 0, transition: "opacity 400ms ease" }}>
                  <circle r={13} className="fill-white" />
                  <Bike x={-8} y={-8} width={16} height={16} className="text-zinc-950" />
                </g>
              </svg>

              <ol aria-label="Estados del domicilio" className="mt-3 grid grid-cols-5 gap-1.5 px-1 pb-1">
                {deliverySteps.map((step, index) => (
                  <li key={step.label} className="flex flex-col items-center gap-1.5 text-center">
                    <span
                      className={cn(
                        "h-1.5 w-full rounded-full transition-colors duration-500",
                        index <= active ? "bg-gradient-to-r from-violet-400 to-fuchsia-400" : "bg-white/10",
                      )}
                    />
                    <span className={cn("text-[11px] leading-tight transition-colors sm:text-xs", index === active ? "text-white" : index < active ? "text-zinc-400" : "text-zinc-600")}>
                      {step.label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-3xl border border-white/10 bg-zinc-900/70 p-5 backdrop-blur sm:p-6">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Domicilio #88</p>
                <span
                  key={active}
                  className={cn(
                    "lp-fade-in inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    delivered ? "bg-emerald-500/15 text-emerald-300" : "bg-fuchsia-500/15 text-fuchsia-200",
                  )}
                >
                  {deliverySteps[active].label}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{elapsedByStep[active]}</p>

              <dl className="mt-5 space-y-2 text-sm">
                {[
                  ["Cliente", "Laura Gómez · 300 *** 4521"],
                  ["Dirección", "Cra 15 # 82-30, apto 402"],
                  ["Pago", "Contra entrega · cambio para $50.000"],
                  ["Domicilio", "$5.000"],
                ].map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-4">
                    <dt className="text-zinc-500">{term}</dt>
                    <dd className="text-right text-zinc-200">{value}</dd>
                  </div>
                ))}
              </dl>

              <p key={`detail-${active}`} className="lp-fade-in mt-5 hidden border-t border-white/10 pt-4 text-sm text-zinc-400 sm:block">
                {deliverySteps[active].detail}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
