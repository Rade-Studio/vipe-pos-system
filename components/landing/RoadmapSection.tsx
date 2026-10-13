"use client"

import { roadmap } from "@/components/landing/content"
import { Reveal, SplitWords, useScrollProgress } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

export function RoadmapSection() {
  const [ref, progress] = useScrollProgress<HTMLOListElement>("through")
  // Draw the line slightly ahead of the reader so the next node is already lit.
  const drawn = Math.min(1, progress * 1.35)

  return (
    <section id="roadmap" data-testid="roadmap" className="relative mx-auto max-w-5xl px-6 py-32">
      <div className="text-center">
        <Reveal>
          <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Lo que se viene</p>
        </Reveal>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          <SplitWords text="Esto apenas empieza." />
        </h2>
        <Reveal delay={250}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            Mejoras planeadas para las próximas versiones. Son expansión del producto, no huecos que impidan operar un
            restaurante hoy.
          </p>
        </Reveal>
      </div>

      <ol ref={ref} className="relative mt-20">
        <div aria-hidden className="absolute bottom-0 left-5 top-0 w-px bg-white/10 md:left-1/2" />
        <div
          aria-hidden
          className="absolute left-5 top-0 w-px origin-top bg-gradient-to-b from-violet-400 via-fuchsia-400 to-sky-400 md:left-1/2"
          style={{ height: `${drawn * 100}%` }}
        />

        {roadmap.map((item, index) => {
          const left = index % 2 === 0
          const lit = drawn * roadmap.length > index + 0.3
          return (
            <li key={item.title} className="relative grid py-8 pl-16 md:grid-cols-2 md:pl-0">
              <span
                aria-hidden
                className={cn(
                  "absolute left-5 top-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border transition-all duration-500 md:left-1/2",
                  lit
                    ? "border-violet-300/60 bg-violet-500/20 text-violet-200 shadow-[0_0_30px_-4px_rgba(167,139,250,0.9)]"
                    : "border-white/10 bg-zinc-950 text-zinc-600",
                )}
              >
                <item.icon className="h-4 w-4" />
              </span>
              <Reveal
                variant={left ? "left" : "right"}
                className={cn(left ? "md:col-start-1 md:pr-16 md:text-right" : "md:col-start-2 md:pl-16")}
              >
                <span className="text-xs uppercase tracking-[0.25em] text-zinc-500">Próximamente</span>
                <h3 className="mt-2 text-2xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-zinc-400">{item.description}</p>
              </Reveal>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
