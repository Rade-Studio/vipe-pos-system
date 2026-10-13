"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, Sparkles } from "lucide-react"
import { heroChips } from "@/components/landing/content"
import { Reveal, SplitWords, usePageScroll, usePrefersReducedMotion } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

type TableStatus = "available" | "occupied" | "kitchen" | "served" | "reserved"

const statusStyle: Record<TableStatus, { label: string; className: string }> = {
  available: { label: "Libre", className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  occupied: { label: "Ocupada", className: "border-violet-400/50 bg-violet-500/15 text-violet-200" },
  kitchen: { label: "Cocina", className: "border-orange-400/50 bg-orange-500/15 text-orange-200" },
  served: { label: "Servida", className: "border-sky-400/50 bg-sky-500/15 text-sky-200" },
  reserved: { label: "Reserva", className: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300" },
}

const cycle: TableStatus[] = ["available", "occupied", "kitchen", "served"]
const initialTables: TableStatus[] = [
  "occupied", "available", "kitchen", "served",
  "available", "reserved", "occupied", "kitchen",
  "served", "available", "occupied", "available",
]

function useLiveTables(enabled: boolean) {
  const [tables, setTables] = useState(initialTables)
  const [pulse, setPulse] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      setTables((current) => {
        const index = Math.floor(Math.random() * current.length)
        if (current[index] === "reserved") return current
        const next = [...current]
        next[index] = cycle[(cycle.indexOf(current[index]) + 1) % cycle.length]
        setPulse(index)
        return next
      })
    }, 1300)
    return () => window.clearInterval(id)
  }, [enabled])
  return { tables, pulse }
}

export function Hero() {
  const { y } = usePageScroll()
  const reduced = usePrefersReducedMotion()
  const { tables, pulse } = useLiveTables(!reduced)
  const tilt = reduced ? 0 : Math.max(0, 28 - y / 14)
  const lift = reduced ? 1 : Math.min(1.06, 0.92 + y / 3000)

  return (
    <section id="inicio" className="relative isolate overflow-hidden pt-36 pb-24 sm:pt-44">
      <div aria-hidden className="lp-grid absolute inset-0 -z-10 opacity-60" />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 -z-10 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-violet-600/30 blur-[120px]"
        style={{ transform: `translate(-50%, ${y * 0.3}px)` }}
      />
      <div
        aria-hidden
        className="absolute top-80 -left-40 -z-10 h-[26rem] w-[26rem] rounded-full bg-indigo-500/20 blur-[110px]"
        style={{ transform: `translateY(${y * -0.15}px)` }}
      />
      <div
        aria-hidden
        className="absolute top-40 -right-32 -z-10 h-[22rem] w-[22rem] rounded-full bg-fuchsia-500/15 blur-[110px]"
        style={{ transform: `translateY(${y * 0.2}px)` }}
      />

      <div className="mx-auto max-w-6xl px-6 text-center">
        <Reveal variant="zoom">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 text-sm text-violet-200">
            <Sparkles className="h-4 w-4" />
            Hecho para restaurantes en Colombia
          </span>
        </Reveal>

        <h1 className="mx-auto mt-8 max-w-5xl text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
          <SplitWords text="Tu restaurante," />
          <br />
          <SplitWords text="por fin en sincronía." className="lp-gradient-text" delay={250} />
        </h1>

        <Reveal delay={500}>
          <p className="mx-auto mt-8 max-w-2xl text-lg text-zinc-400 sm:text-xl">
            Salón, domicilios, cocina, caja y administración conectados en vivo. VipePOS se encarga del papel, las
            cuentas y el inventario para que tú te encargues de la comida.
          </p>
        </Reveal>

        <Reveal delay={700} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/portal"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-medium text-zinc-950 shadow-[0_0_40px_-8px_rgba(167,139,250,0.8)] transition hover:scale-[1.03]"
          >
            Entrar al sistema
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <a
            href="#flujo"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-7 py-3.5 font-medium text-white/90 transition hover:border-white/40 hover:bg-white/5"
          >
            Ver cómo funciona
          </a>
        </Reveal>
      </div>

      <div className="relative mx-auto mt-20 max-w-5xl px-6 [perspective:1600px]">
        <div
          className="relative rounded-[2rem] border border-white/10 bg-zinc-900/70 p-3 shadow-[0_40px_120px_-30px_rgba(124,58,237,0.6)] backdrop-blur-xl"
          style={{
            transform: `rotateX(${tilt}deg) scale(${lift})`,
            transformOrigin: "50% 0%",
            transition: "transform 120ms linear",
          }}
        >
          <div className="rounded-[1.5rem] border border-white/5 bg-zinc-950/90 p-5 text-left sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/vipe-pos.png" alt="" className="h-9 w-9" />
                <div>
                  <p className="text-sm font-semibold">Salón principal</p>
                  <p className="text-xs text-zinc-500">Vista de mesero · en vivo</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Sincronizado
              </span>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {tables.map((status, index) => (
                <div
                  key={index}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center rounded-2xl border text-center transition-all duration-500",
                    statusStyle[status].className,
                    pulse === index && "scale-105",
                  )}
                >
                  {pulse === index && (
                    <span className="absolute inset-0 animate-ping rounded-2xl border border-current opacity-40" />
                  )}
                  <span className="text-2xl font-semibold text-white">{index + 1}</span>
                  <span className="mt-1 text-[11px] uppercase tracking-wider">{statusStyle[status].label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {heroChips.map(({ icon: Icon, text }, index) => (
          <div
            key={text}
            className={cn(
              "lp-float absolute z-10 hidden items-center gap-2 whitespace-nowrap rounded-2xl border border-white/10 bg-zinc-900/80 px-4 py-2.5 text-sm text-zinc-200 shadow-xl backdrop-blur-xl xl:flex",
              ["-left-36 top-4", "-right-40 top-28", "-left-32 bottom-20", "-right-32 bottom-0"][index],
            )}
            style={{ animationDelay: `${index * -1.5}s` }}
          >
            <Icon className="h-4 w-4 text-violet-300" />
            {text}
          </div>
        ))}
      </div>

      <a
        href="#quitas"
        aria-label="Seguir bajando"
        className="mx-auto mt-20 flex w-fit flex-col items-center gap-2 text-xs uppercase tracking-[0.3em] text-zinc-500 transition hover:text-zinc-300"
        style={{ opacity: Math.max(0, 1 - y / 300) }}
      >
        Desliza
        <ChevronDown className="h-5 w-5 animate-bounce" />
      </a>
    </section>
  )
}
