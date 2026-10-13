"use client"

import { Check } from "lucide-react"
import { roles } from "@/components/landing/content"
import { Reveal, SplitWords, TiltCard } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

export function RolesSection() {
  return (
    <section id="roles" data-testid="roles" className="relative mx-auto max-w-6xl px-6 py-32">
      <div className="max-w-3xl">
        <Reveal>
          <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Cinco vistas, un solo sistema</p>
        </Reveal>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
          <SplitWords text="Cada persona ve exactamente lo que necesita." />
        </h2>
        <Reveal delay={250}>
          <p className="mt-6 text-lg text-zinc-400">
            Cuentas individuales por empleado, permisos reforzados en la base de datos y un administrador que puede
            entrar a cualquier vista para supervisar sin cerrar sesión.
          </p>
        </Reveal>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {roles.map((role, index) => (
          <Reveal
            key={role.name}
            delay={(index % 3) * 120}
            variant={index % 2 === 0 ? "left" : "right"}
            // Five cards on a three-column grid: the last one spans the remaining row.
            className={cn(index === roles.length - 1 && "md:col-span-2 lg:col-span-2")}
          >
            <TiltCard className="h-full rounded-3xl border border-white/10 bg-zinc-900/60 p-8 backdrop-blur">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg [transform:translateZ(40px)]",
                    role.accent,
                  )}
                >
                  <role.icon className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-semibold">{role.name}</h3>
                  <p className="text-sm text-zinc-400">{role.tagline}</p>
                </div>
              </div>
              <ul className="mt-8 space-y-3">
                {role.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-zinc-300">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                    {feature}
                  </li>
                ))}
              </ul>
            </TiltCard>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
