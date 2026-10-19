"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { DeliverySection } from "@/components/landing/DeliverySection"
import { FeaturesSection } from "@/components/landing/FeaturesSection"
import { Hero } from "@/components/landing/Hero"
import { InventorySection } from "@/components/landing/InventorySection"
import { LiveFlowSection } from "@/components/landing/LiveFlowSection"
import { PainsSection } from "@/components/landing/PainsSection"
import { RoadmapSection } from "@/components/landing/RoadmapSection"
import { RolesSection } from "@/components/landing/RolesSection"
import { Reveal, SplitWords, usePageScroll } from "@/components/landing/motion"
import { cn } from "@/lib/utils"

const nav = [
  { href: "#quitas", label: "Beneficios" },
  { href: "#flujo", label: "Cómo funciona" },
  { href: "#roles", label: "Roles" },
  { href: "#domicilios", label: "Domicilios" },
  { href: "#ventajas", label: "Ventajas" },
  { href: "#roadmap", label: "Roadmap" },
]

function Navbar() {
  const { y, progress } = usePageScroll()
  const scrolled = y > 24
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        scrolled ? "border-b border-white/10 bg-[#07060d]/70 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#inicio" className="flex items-center gap-2.5 font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vipe-pos.png" alt="" className="h-8 w-8" />
          VipePOS
        </a>
        <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="transition hover:text-white">
              {item.label}
            </a>
          ))}
        </nav>
        <Link
          href="/portal"
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
        >
          Entrar al sistema
        </Link>
      </div>
      <div
        aria-hidden
        className="h-px origin-left bg-gradient-to-r from-violet-500 via-fuchsia-400 to-sky-400"
        style={{ transform: `scaleX(${progress})` }}
      />
    </header>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden px-6 py-40">
      <div
        aria-hidden
        className="lp-orbit absolute left-1/2 top-1/2 -z-10 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[conic-gradient(from_0deg,rgba(124,58,237,0.35),rgba(56,189,248,0.2),rgba(236,72,153,0.25),rgba(124,58,237,0.35))] blur-[100px]"
      />
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-5xl font-semibold tracking-tight sm:text-7xl">
          <SplitWords text="Deja que el sistema" />
          <br />
          <SplitWords text="haga el trabajo pesado." className="lp-gradient-text" delay={200} />
        </h2>
        <Reveal delay={400}>
          <p className="mx-auto mt-8 max-w-xl text-lg text-zinc-400">
            En la nube o en tu propio servidor. En tablet, celular o computador. Listo para operar hoy.
          </p>
        </Reveal>
        <Reveal delay={600} className="mt-12 flex justify-center">
          <Link
            href="/portal"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-medium text-zinc-950 shadow-[0_0_60px_-8px_rgba(167,139,250,0.9)] transition hover:scale-[1.04]"
          >
            Entrar al sistema
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
      </div>
    </section>
  )
}

export function LandingPage() {
  return (
    <div className="lp-root min-h-screen bg-[#07060d] text-white antialiased selection:bg-violet-500/40">
      <Navbar />
      <main>
        <Hero />
        <PainsSection />
        <LiveFlowSection />
        <RolesSection />
        <DeliverySection />
        <InventorySection />
        <FeaturesSection />
        <RoadmapSection />
        <FinalCta />
      </main>
      <footer className="border-t border-white/10 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-sm text-zinc-500 sm:flex-row">
          <span>© {new Date().getFullYear()} VipePOS · Punto de venta para restaurantes</span>
          <a
            href="https://radestudio.org"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 text-zinc-500 transition hover:text-zinc-300"
          >
            <span>Un producto de</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/rade-horizontal-sobre-oscuro.svg"
              alt="RADE Studio"
              width={113}
              height={30}
              className="h-7 w-auto opacity-80 transition group-hover:opacity-100"
            />
          </a>
        </div>
      </footer>
    </div>
  )
}
