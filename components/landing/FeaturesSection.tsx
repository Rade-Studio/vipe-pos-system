"use client"

import { features, marquee, stats } from "@/components/landing/content"
import { CountUp, Reveal, SplitWords, TiltCard } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

export function FeaturesSection() {
  return (
    <section id="ventajas" className="relative pb-32 pt-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Por qué VipePOS</p>
          </Reveal>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
            <SplitWords text="Nivel productivo, no un prototipo." />
          </h2>
        </div>

        <div className="mt-16 grid auto-rows-fr gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Reveal
              key={feature.title}
              delay={(index % 4) * 100}
              variant="zoom"
              className={cn(feature.wide && "lg:col-span-2")}
            >
              <TiltCard className="h-full rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-7">
                <feature.icon className="h-8 w-8 text-violet-300" />
                <h3 className="mt-6 text-xl font-semibold">{feature.title}</h3>
                <p className="mt-2 text-zinc-400">{feature.description}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </div>

      <div className="relative mt-24 overflow-hidden border-y border-white/10 py-6 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="lp-marquee flex w-max gap-4">
          {[...marquee, ...marquee].map((item, index) => (
            <span
              key={`${item}-${index}`}
              aria-hidden={index >= marquee.length}
              className="whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-zinc-300"
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-24 grid max-w-6xl gap-10 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 120} className="text-center">
            <p className="lp-gradient-text text-7xl font-semibold tabular-nums">
              <CountUp to={stat.value} suffix={stat.suffix} />
            </p>
            <p className="mt-2 text-zinc-400">{stat.label}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
