"use client"

import { Receipt } from "lucide-react"
import { flow } from "@/components/landing/content"
import { segment, useScrollProgress } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

const stationColors = ["text-violet-300", "text-orange-300", "text-emerald-300", "text-sky-300"]
const stationGlows = [
  "shadow-[0_0_60px_-6px_rgba(167,139,250,0.9)]",
  "shadow-[0_0_60px_-6px_rgba(251,146,60,0.9)]",
  "shadow-[0_0_60px_-6px_rgba(52,211,153,0.9)]",
  "shadow-[0_0_60px_-6px_rgba(56,189,248,0.9)]",
]

export function LiveFlowSection() {
  const [ref, progress] = useScrollProgress<HTMLElement>("sticky")
  // The ticket travels during the middle of the pin; the edges give breathing room.
  const travel = segment(progress, 0.08, 0.92)
  const active = Math.min(flow.length - 1, Math.floor(travel * flow.length * 0.999))
  const step = flow[active]

  return (
    <section id="flujo" ref={ref} className="relative h-[400vh]">
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.18),transparent_65%)]" />

        <div className="mx-auto w-full max-w-6xl px-6">
          <p className="text-center text-sm uppercase tracking-[0.3em] text-violet-300">Un pedido, cero fricción</p>
          <h2 className="mx-auto mt-4 max-w-3xl text-center text-4xl font-semibold tracking-tight sm:text-6xl">
            De la mesa al reporte, <span className="lp-gradient-text">sin tocar un papel.</span>
          </h2>

          <div className="relative mx-auto mt-36 max-w-4xl">
            {/* Inset by half a station so the rail runs center to center. */}
            <div className="absolute inset-x-7 top-7 h-1 -translate-y-1/2 sm:inset-x-10 sm:top-10">
              <div className="absolute inset-0 rounded-full bg-white/10" />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-orange-400 via-60% to-sky-400"
                style={{ width: `${travel * 100}%` }}
              />
            </div>

            <div className="relative flex justify-between">
              {flow.map(({ role, icon: Icon }, index) => {
                const reached = travel * (flow.length - 1) >= index - 0.02
                return (
                  <div key={role} className="flex flex-col items-center">
                    <div
                      className={cn(
                        "flex h-14 w-14 items-center justify-center rounded-2xl border transition-all duration-500 sm:h-20 sm:w-20",
                        reached
                          ? cn("scale-110 border-white/30 bg-zinc-900", stationColors[index], index === active && stationGlows[index])
                          : "border-white/10 bg-zinc-950 text-zinc-600",
                      )}
                    >
                      <Icon className="h-6 w-6 sm:h-8 sm:w-8" />
                    </div>
                    <span className={cn("mt-3 text-sm font-medium transition-colors", reached ? "text-white" : "text-zinc-600")}>
                      {role}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="pointer-events-none absolute inset-x-7 -top-24 sm:inset-x-10">
            <div className="absolute w-40 -translate-x-1/2 sm:w-52" style={{ left: `${travel * 100}%` }}>
              <div className="rounded-xl border border-white/15 bg-zinc-900/90 p-3 text-left shadow-2xl backdrop-blur">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Receipt className="h-3.5 w-3.5" />
                  Pedido #1042
                </div>
                <p key={step.status} className={cn("lp-fade-in mt-1 text-sm font-semibold", stationColors[active])}>
                  {step.status}
                </p>
              </div>
            </div>
            </div>
          </div>

          <div className="relative mx-auto mt-16 h-40 max-w-2xl text-center">
            {flow.map((item, index) => (
              <div
                key={item.role}
                className="absolute inset-0 transition-all duration-500"
                style={{
                  opacity: index === active ? 1 : 0,
                  transform: index === active ? "none" : `translateY(${index < active ? -24 : 24}px)`,
                }}
                aria-hidden={index !== active}
              >
                <h3 className="text-2xl font-semibold sm:text-3xl">{item.title}</h3>
                <p className="mt-3 text-lg text-zinc-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 gap-2">
          {flow.map((item, index) => (
            <span
              key={item.role}
              className={cn("h-1.5 rounded-full transition-all duration-500", index === active ? "w-8 bg-white" : "w-1.5 bg-white/25")}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
