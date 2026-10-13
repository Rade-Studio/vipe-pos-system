"use client"

import { Check, X } from "lucide-react"
import { pains, type Pain } from "@/components/landing/content"
import { Reveal, SplitWords, useInView, usePrefersReducedMotion } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

function PainRow({ pain, index }: { pain: Pain; index: number }) {
  const [ref, inView] = useInView<HTMLLIElement>({ threshold: 0.7, rootMargin: "0px 0px -15% 0px" })
  const reduced = usePrefersReducedMotion()
  const done = inView || reduced
  const ease = reduced ? "none" : undefined

  return (
    <li ref={ref} className="group border-b border-white/10 py-8 first:border-t">
      <div className="flex items-start gap-5">
        <span className="mt-2 font-mono text-xs text-zinc-600">{String(index + 1).padStart(2, "0")}</span>
        <div className="flex-1">
          <p className="relative inline-flex items-center gap-3 text-2xl font-medium sm:text-3xl">
            <X
              className={cn("h-6 w-6 shrink-0 text-rose-400 transition-all duration-700", done ? "opacity-40" : "opacity-100")}
            />
            <span className={cn("relative transition-colors duration-700", done ? "text-zinc-600" : "text-zinc-200")}>
              {pain.before}
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-rose-500 to-violet-500"
                style={{
                  transform: done ? "scaleX(1)" : "scaleX(0)",
                  transition: ease ?? "transform 900ms cubic-bezier(.65,0,.35,1) 150ms",
                }}
              />
            </span>
          </p>
          <p
            className="mt-3 flex items-center gap-3 text-lg text-emerald-300 sm:text-xl"
            style={{
              opacity: done ? 1 : 0,
              transform: done ? "none" : "translate3d(-16px,0,0)",
              transition: ease ?? "opacity 700ms ease 700ms, transform 700ms cubic-bezier(.16,1,.3,1) 700ms",
            }}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15">
              <Check className="h-4 w-4" />
            </span>
            {pain.after}
          </p>
        </div>
      </div>
    </li>
  )
}

export function PainsSection() {
  return (
    <section id="quitas" data-testid="pains" className="relative mx-auto max-w-6xl px-6 py-32">
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="lg:sticky lg:top-32 lg:h-fit">
          <Reveal>
            <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Peso muerto</p>
          </Reveal>
          <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            <SplitWords text="Todo lo que te quitas de encima." />
          </h2>
          <Reveal delay={300}>
            <p className="mt-6 max-w-md text-lg text-zinc-400">
              Cada tarea repetitiva que hoy te roba tiempo, plata o tranquilidad, el sistema la resuelve por ti.
              Baja y mira cómo desaparecen.
            </p>
          </Reveal>
        </div>

        <ol>
          {pains.map((pain, index) => (
            <PainRow key={pain.before} pain={pain} index={index} />
          ))}
        </ol>
      </div>
    </section>
  )
}
