"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Menu, X } from "lucide-react"
import { BRAND_NAME } from "@/lib/brand"
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

/**
 * H-106: without JavaScript nothing animates in, so the server HTML must not stay
 * hidden. The animated blocks carry data-reveal; the scroll-driven flow stage is
 * swapped for its static list of steps.
 */
const NO_SCRIPT_CSS =
  "[data-reveal]{opacity:1 !important;transform:none !important;filter:none !important}" +
  "[data-noscript-hide]{display:none !important}" +
  "[data-noscript-show]{position:static !important;width:auto !important;height:auto !important;margin:2rem 0 0 !important;overflow:visible !important;clip:auto !important;white-space:normal !important}" +
  "#flujo{height:auto !important}#flujo>div{position:static !important;height:auto !important;padding:8rem 0}"

function Navbar() {
  const { y, progress } = usePageScroll()
  const [menuOpen, setMenuOpen] = useState(false)
  const scrolled = y > 24 || menuOpen
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
          <img src="/vipe-pos-64.png" alt="" width={32} height={32} className="h-8 w-8" />
          {BRAND_NAME}
        </a>
        <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="transition hover:text-white">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/portal"
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            Entrar al sistema
          </Link>
          {/* H-107: below md the section links live behind this menu button. */}
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/10 md:hidden"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            aria-controls="landing-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="landing-menu" aria-label="Menú" className="border-t border-white/10 px-6 pb-4 md:hidden">
          <ul className="flex flex-col">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="block py-3 text-base text-zinc-300 transition hover:text-white"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
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
      <noscript dangerouslySetInnerHTML={{ __html: `<style>${NO_SCRIPT_CSS}</style>` }} />
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-zinc-500 sm:flex-row">
          <span>© {new Date().getFullYear()} {BRAND_NAME} · Punto de venta para restaurantes</span>
          <span>Hecho con Next.js, NestJS, PostgreSQL y mucho café.</span>
        </div>
      </footer>
    </div>
  )
}
