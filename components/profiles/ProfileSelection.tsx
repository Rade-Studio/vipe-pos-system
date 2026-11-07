"use client"

import { Fragment, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { ArrowRight, Bike, Calculator, ChefHat, ConciergeBell, LogOut, SlidersVertical, type LucideIcon } from "lucide-react"
import type { Profile, ProfileRole } from "@/types"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { signOutAndReload } from "@/lib/api/auth"
import { roleLabel } from "@/lib/auth/roles"
import { STATIONS, stationCounts } from "@/lib/profiles/stations"
import { useProfileStore } from "@/store/useProfileStore"
import { useTableStore } from "@/store/useTableStore"
import { useOrderStore } from "@/store/useOrderStore"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useConfigStore } from "@/store/use-config-store"
import { cn } from "@/lib/utils"

interface ProfileSelectionProps {
  profiles: Profile[]
  onSelectProfile: (profile: Profile) => void
}

const ICONS: Record<ProfileRole, LucideIcon> = {
  waiter: ConciergeBell,
  kitchen: ChefHat,
  cashier: Calculator,
  delivery_operator: Bike,
  admin: SlidersVertical,
}

// Status palette per station, as in the artboard (`.r-mesero` … `.r-admin`).
const TONES: Record<ProfileRole, string> = {
  waiter: "bg-status-occupied-bg text-status-occupied-fg border-status-occupied-line",
  kitchen: "bg-status-kitchen-bg text-status-kitchen-fg border-status-kitchen-line",
  cashier: "bg-status-ok-bg text-status-ok-fg border-status-ok-line",
  delivery_operator: "bg-status-served-bg text-status-served-fg border-status-served-line",
  admin: "bg-status-reserved-bg text-status-reserved-fg border-status-reserved-line",
}

const kbdClass =
  "grid place-items-center rounded-lg border border-b-[3px] border-line-strong bg-surface font-mono font-semibold text-fg-2"

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest("input, textarea, select") !== null
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
}

export function ProfileSelection({ profiles, onSelectProfile }: ProfileSelectionProps) {
  const authProfile = useProfileStore((s) => s.authProfile)
  const businessName = useConfigStore((s) => s.businessName)
  const tables = useTableStore((s) => s.tables)
  const orders = useOrderStore((s) => s.orders)
  const registers = useCashRegisterStore((s) => s.registers)
  const counts = useMemo(() => stationCounts({ tables, orders, registers }), [tables, orders, registers])
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])

  // The same role tiles as before (internal waiters stay out), in launcher order.
  const stations = useMemo(
    () =>
      STATIONS.flatMap((station) => {
        const profile = profiles.find((p) => p.role === station.role && !p.id.startsWith("internal-"))
        return profile ? [{ ...station, profile }] : []
      }),
    [profiles],
  )
  // `changeProfile()` clears the impersonated view, so the current profile is the real one.
  const currentRole = authProfile?.role
  const adminTile = stations.find((s) => s.role === "admin")?.profile

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return
      if (event.key === "Escape") {
        if (adminTile) onSelectProfile(adminTile)
        return
      }
      const station = /^[1-9]$/.test(event.key) ? stations[Number(event.key) - 1] : undefined
      if (station) {
        event.preventDefault()
        onSelectProfile(station.profile)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [stations, adminTile, onSelectProfile])

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const index = rowRefs.current.findIndex((row) => row === document.activeElement)
    if (index < 0) return
    event.preventDefault()
    const step = event.key === "ArrowDown" ? 1 : stations.length - 1
    rowRefs.current[(index + step) % stations.length]?.focus()
  }

  const userName = authProfile?.full_name || authProfile?.name

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 font-semibold">
          <span aria-hidden="true" className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-brand font-bold text-brand-contrast">
            V
          </span>
          <span className="min-w-0">
            <span className="block truncate">{businessName}</span>
            <small className="block text-xs font-normal leading-tight text-muted-fg">VipePOS</small>
          </span>
        </div>
        <div className="flex-1" />
        <div className="[&_button]:h-11 [&_button]:w-11 [&_button]:rounded-pill">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl items-start gap-4 px-3 py-5 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <section aria-labelledby="profile-select-title" className="min-w-0">
          <p className="mb-2 text-xs uppercase tracking-[0.3em] text-brand-strong">Terminal compartida</p>
          <h1 id="profile-select-title" className="mb-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Seleccionar perfil
          </h1>
          <p className="mb-5 text-muted-fg">Toca una estación o pulsa su número en el teclado.</p>

          <ul
            aria-label="Estaciones"
            onKeyDown={onListKeyDown}
            className="overflow-hidden rounded-card-lg border border-line bg-surface [&>li+li]:border-t [&>li+li]:border-line"
          >
            {stations.map((station, index) => {
              const Icon = ICONS[station.role]
              const key = String(index + 1)
              const current = station.role === currentRole
              const context = current ? "Perfil actual" : counts[station.role]
              return (
                <li key={station.role}>
                  <button
                    ref={(el) => {
                      rowRefs.current[index] = el
                    }}
                    type="button"
                    aria-keyshortcuts={key}
                    aria-current={current ? "true" : undefined}
                    aria-label={[`${key}. ${station.name}`, station.purpose, context].filter(Boolean).join(". ")}
                    onClick={() => onSelectProfile(station.profile)}
                    className={cn(
                      "grid min-h-[72px] w-full grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-x-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2",
                      "focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:-outline-offset-4 focus-visible:outline-focus",
                      "sm:min-h-[84px] sm:grid-cols-[40px_44px_minmax(0,1fr)_auto_24px] sm:gap-4 sm:px-5",
                      current && "bg-brand-tint hover:bg-brand-tint",
                    )}
                  >
                    <kbd
                      aria-hidden="true"
                      className={cn(kbdClass, "hidden h-10 w-10 text-base sm:grid", current && "border-brand-line text-brand-strong")}
                    >
                      {key}
                    </kbd>
                    <span
                      className={cn(
                        "row-span-2 grid h-11 w-11 place-items-center rounded-xl border-[1.5px] sm:row-span-1",
                        TONES[station.role],
                      )}
                    >
                      <Icon aria-hidden="true" className="h-6 w-6" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-semibold">{station.name}</span>
                      <span className="block text-[13px] text-muted-fg sm:text-sm">{station.purpose}</span>
                    </span>
                    <span className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto">
                      {current ? (
                        <span className="inline-flex min-w-max flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border border-brand-line bg-brand-tint px-2.5 py-0.5 text-xs font-medium text-brand-strong">
                          <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />
                          Perfil actual
                        </span>
                      ) : context ? (
                        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-fg-2 sm:text-[13px]">{context}</span>
                      ) : null}
                    </span>
                    <ArrowRight
                      aria-hidden="true"
                      className="col-start-3 row-span-2 row-start-1 h-5 w-5 text-muted-fg sm:col-auto sm:row-auto sm:h-6 sm:w-6"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-fg">Conteos tomados de lo que la app ya cargó.</p>
        </section>

        <aside className="flex flex-col gap-4">
          <div className="rounded-card-lg border border-line bg-surface p-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 flex-none place-items-center rounded-full border border-brand-line bg-brand-tint text-[13px] font-semibold text-brand-strong"
              >
                {userName ? initials(userName) : "?"}
              </span>
              <span className="min-w-0">
                <b className="block truncate text-sm font-semibold" title={userName}>
                  {userName}
                </b>
                <small className="block text-xs text-muted-fg">{roleLabel(authProfile?.role)}</small>
              </span>
            </div>
            <button
              type="button"
              onClick={() => signOutAndReload()}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-pill border border-line-strong px-4 font-medium transition-colors hover:border-brand-line hover:bg-surface-2 focus-visible:outline-dashed focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-focus"
            >
              <LogOut aria-hidden="true" className="h-5 w-5" />
              Cerrar sesión
            </button>
          </div>

          <section aria-labelledby="profile-select-keys" className="hidden rounded-card-lg border border-line bg-surface p-5 sm:block">
            <h2 id="profile-select-keys" className="mb-3 text-sm font-semibold">
              Atajos de teclado
            </h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2.5 text-[13px] text-fg-2">
              {[
                [["1", "5"], "Entrar a la estación", "–"],
                [["↑", "↓"], "Moverse en la lista", ""],
                [["Esc"], "Volver al panel de Admin", ""],
              ].map(([keys, label, joiner]) => (
                <Fragment key={label as string}>
                  <dt className="flex items-center gap-1 whitespace-nowrap">
                    {(keys as string[]).map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        {i > 0 && joiner}
                        <kbd className={cn(kbdClass, "h-[30px] min-w-8 border-b-2 px-2 text-[13px]")}>{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className="m-0">{label as string}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        </aside>
      </main>
    </div>
  )
}
