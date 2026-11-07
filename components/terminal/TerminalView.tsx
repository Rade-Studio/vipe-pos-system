"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Delete, LogOut, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { useWaiters } from "@/hooks/use-waiters"
import { identifyStaff, pinFailureOf, signOutAndReload, type Session } from "@/lib/api/auth"
import { listSupervisors } from "@/lib/api/staff"
import { roleLabel } from "@/lib/auth/roles"
import { clearActingToken, setActingToken } from "@/lib/terminal/acting"
import { clockTime, countdown, initialsOf } from "@/lib/terminal/format"
import { PIN_MAX_LENGTH } from "@/lib/terminal/pin"
import { cn } from "@/lib/utils"
import { useProfileStore } from "@/store/useProfileStore"
import type { Profile, ProfileRole } from "@/types"

/** Same length as ACTING_TTL_MS in the API: the claim never outlives it here. */
const ACTING_TTL_MS = 5 * 60_000

interface Person {
  id: string
  name: string
  role: string
}

interface Identity {
  person: Person
  deadline: number
}

type Screen =
  | { kind: "grid" }
  | { kind: "pin"; person: Person }
  | { kind: "orders" }
  | { kind: "expired" }
  | { kind: "close"; back: Screen }
  | { kind: "closePin"; person: Person; back: Screen }

interface TerminalViewProps {
  /** The terminal session (POST /auth/terminal/login): its profile is the admin or cashier who opened it. */
  session: Session
  /** The order screen (WaiterView), with the terminal bar to show in place of its header. */
  children: (bar: ReactNode) => ReactNode
}

const toProfile = (person: Person): Profile => ({
  id: person.id,
  name: person.name,
  full_name: person.name,
  role: person.role as ProfileRole,
})

/**
 * Shared order-taking terminal (F4, design/acceso-meseros/02-terminal-compartida.html).
 * Each waiter taps their name and types their PIN (POST /auth/identify); for
 * 5 minutes the order screen runs as them: the store's profile is theirs and
 * the API client adds their acting claim to every write. When the time is up
 * the order screen stays mounted under a dialog and the cart (useCartStore)
 * is kept, unsent. Closing it asks any active admin or cashier to tap their
 * name and type their PIN (GET /staff/supervisors, then POST /auth/identify).
 */
export function TerminalView({ session, children }: TerminalViewProps) {
  const opener: Person = { id: session.profile.id, name: session.profile.name, role: session.profile.role }
  const { data: waiters = [], isLoading, isError } = useWaiters()
  const [screen, setScreen] = useState<Screen>({ kind: "grid" })
  const [identity, setIdentity] = useState<Identity | null>(null)
  /** The last identified person: their order screen stays mounted (and their cart) between identifications. */
  const [last, setLast] = useState<Person | null>(null)
  /** Lock ends the API reported in this terminal, per profile (ISO). */
  const [locks, setLocks] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())
  const supervisors = useQuery({
    queryKey: ["terminal", "supervisors"],
    queryFn: listSupervisors,
    enabled: screen.kind === "close",
  })

  const endIdentity = useCallback(() => {
    clearActingToken()
    setIdentity(null)
  }, [])

  useEffect(() => () => clearActingToken(), [])

  useEffect(() => {
    if (!identity) return
    const id = setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= identity.deadline) {
        endIdentity()
        setScreen({ kind: "expired" })
      }
    }, 1000)
    return () => clearInterval(id)
  }, [identity, endIdentity])

  const identified = (person: Person, token: string, expiresAt: string) => {
    const at = Date.now()
    setActingToken(token)
    setIdentity({ person, deadline: Math.min(Date.parse(expiresAt), at + ACTING_TTL_MS) })
    setNow(at)
    setLast(person)
    setLocks((current) => {
      const rest = { ...current }
      delete rest[person.id]
      return rest
    })
    const profile = toProfile(person)
    useProfileStore.setState({ authProfile: profile, selectedProfile: profile })
    setScreen({ kind: "orders" })
  }

  const changeWaiter = () => {
    endIdentity()
    setScreen({ kind: "grid" })
  }

  const lockOf = (personId: string) => {
    const until = locks[personId]
    return until && Date.parse(until) > Date.now() ? until : undefined
  }
  const remember = (personId: string, until?: string) => {
    if (until) setLocks((current) => ({ ...current, [personId]: until }))
  }

  const openedBy = `Abierta por ${opener.name} (${roleLabel(opener.role) ?? opener.role})`

  const chip = identity && (
    <span
      role="status"
      aria-label={`${identity.person.name} identificado, quedan ${countdown(identity.deadline - now)}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-primary/40 bg-primary/10 py-1 pl-1.5 pr-3.5 font-semibold text-primary"
    >
      <Avatar name={identity.person.name} className="h-8 w-8 bg-primary text-xs text-primary-foreground" />
      <span>
        {identity.person.name} · <span className="tabular-nums">{countdown(identity.deadline - now)}</span>
      </span>
    </span>
  )

  const ordersBar = (
    <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 border-b bg-background px-1 py-2">
      <Brand subtitle={openedBy} compact />
      {chip}
      {screen.kind === "expired" && last && (
        <span className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-status-warning-line bg-status-warning-bg px-3.5 font-semibold text-status-warning-fg">
          {last.name} · venció
        </span>
      )}
      <Button variant="outline" className="min-h-11" onClick={changeWaiter}>
        <Users className="mr-2 h-4 w-4" aria-hidden />
        Cambiar mesero
      </Button>
      <ThemeToggle />
    </div>
  )

  const showOrders = screen.kind === "orders" || screen.kind === "expired"

  return (
    <>
      {last && (
        <div key={last.id} hidden={!showOrders}>
          {children(ordersBar)}
        </div>
      )}

      {!showOrders && (
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <header className="flex min-h-16 flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2">
            <Brand subtitle={openedBy} />
            <ThemeToggle />
          </header>

          <main className="grid flex-1 place-items-center p-4 sm:p-6">
            {screen.kind === "grid" && (
              <section aria-labelledby="terminal-pick-h" className="w-full max-w-4xl">
                <h1 id="terminal-pick-h" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  ¿Quién toma el pedido?
                </h1>
                <p className="mb-5 mt-1 text-muted-foreground">Toca tu nombre y escribe tu PIN.</p>
                {isLoading ? (
                  <p className="text-muted-foreground">Cargando meseros…</p>
                ) : isError ? (
                  <p className="text-destructive">No se pudieron cargar los meseros. Revisa la conexión.</p>
                ) : waiters.length === 0 ? (
                  <p className="text-muted-foreground">No hay meseros activos. Pide al admin que los cree en Personal.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                    {waiters.map((waiter) => {
                      const until = lockOf(waiter.id)
                      return (
                        <button
                          key={waiter.id}
                          type="button"
                          onClick={() => setScreen({ kind: "pin", person: { id: waiter.id, name: waiter.name, role: "waiter" } })}
                          className="flex min-h-40 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-4 text-center transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Avatar name={waiter.name} className="h-16 w-16 text-2xl" />
                          <b className="text-lg leading-tight">{waiter.name}</b>
                          {until ? (
                            <span className="rounded-pill border border-status-danger-line bg-status-danger-bg px-2.5 py-0.5 text-xs font-medium text-status-danger-fg">
                              Bloqueado hasta {clockTime(until)}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">Mesero</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {screen.kind === "pin" && (
              <PinScreen
                key={screen.person.id}
                person={screen.person}
                title={`Hola, ${screen.person.name}`}
                hint="Escribe tu PIN para tomar pedidos. Quedas identificado 5 minutos."
                lockedUntil={lockOf(screen.person.id)}
                onLocked={(until) => remember(screen.person.id, until)}
                onBack={() => setScreen({ kind: "grid" })}
                backLabel={`No soy ${screen.person.name}`}
                onSuccess={async (answer) => identified(screen.person, answer.token, answer.expiresAt)}
              />
            )}

            {screen.kind === "close" && (
              <section aria-labelledby="terminal-close-h" className="w-full max-w-4xl">
                <h1 id="terminal-close-h" className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  ¿Quién cierra la terminal?
                </h1>
                <p className="mb-5 mt-1 text-muted-foreground">
                  Solo un admin o la caja la cierra, con su PIN. Los pedidos sin enviar se pierden.
                </p>
                {supervisors.isLoading ? (
                  <p className="text-muted-foreground">Cargando…</p>
                ) : supervisors.isError ? (
                  <p className="text-destructive">No se pudo cargar quién puede cerrarla. Revisa la conexión.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                    {(supervisors.data ?? []).map((supervisor) => {
                      const until = lockOf(supervisor.id) ?? supervisor.pinLockedUntil ?? undefined
                      const role = roleLabel(supervisor.role) ?? supervisor.role
                      return (
                        <button
                          key={supervisor.id}
                          type="button"
                          disabled={!supervisor.hasPin}
                          onClick={() =>
                            setScreen({
                              kind: "closePin",
                              person: { id: supervisor.id, name: supervisor.fullName, role: supervisor.role },
                              back: screen.back,
                            })
                          }
                          className="flex min-h-40 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-4 text-center transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:hover:border-border"
                        >
                          <Avatar name={supervisor.fullName} className="h-16 w-16 text-2xl" />
                          <b className="text-lg leading-tight">{supervisor.fullName}</b>
                          {!supervisor.hasPin ? (
                            <span className="text-sm text-muted-foreground">Sin PIN</span>
                          ) : until && Date.parse(until) > Date.now() ? (
                            <span className="rounded-pill border border-status-danger-line bg-status-danger-bg px-2.5 py-0.5 text-xs font-medium text-status-danger-fg">
                              Bloqueado hasta {clockTime(until)}
                            </span>
                          ) : (
                            <span className="text-sm text-muted-foreground">{role}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                <Button variant="outline" className="mt-5 min-h-11" onClick={() => setScreen(screen.back)}>
                  Volver
                </Button>
              </section>
            )}

            {screen.kind === "closePin" && (
              <PinScreen
                key={screen.person.id}
                person={screen.person}
                title="Cerrar terminal"
                hint={`${screen.person.name} (${roleLabel(screen.person.role) ?? screen.person.role}) escribe su PIN para cerrar esta terminal. Los pedidos sin enviar se pierden.`}
                lockedUntil={lockOf(screen.person.id)}
                onLocked={(until) => remember(screen.person.id, until)}
                onBack={() => setScreen({ kind: "close", back: screen.back })}
                backLabel={`No soy ${screen.person.name}`}
                onSuccess={async () => {
                  endIdentity()
                  await signOutAndReload()
                }}
              />
            )}
          </main>

          {screen.kind !== "close" && screen.kind !== "closePin" && (
            <footer className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-sm text-muted-foreground">
              <span className="min-w-0 flex-1">Terminal de pedidos: sin acceso a ajustes, personal ni reportes.</span>
              <Button variant="outline" className="min-h-11" onClick={() => setScreen({ kind: "close", back: screen })}>
                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                Cerrar terminal
              </Button>
            </footer>
          )}
        </div>
      )}

      <Dialog open={screen.kind === "expired"} onOpenChange={(open) => !open && setScreen({ kind: "grid" })}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Pasaron 5 minutos sin identificarte</DialogTitle>
            <DialogDescription>
              El pedido sigue aquí, sin enviar.{last ? ` Escribe tu PIN para seguir como ${last.name}.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => setScreen({ kind: "grid" })}>
              Soy otro mesero
            </Button>
            {last && (
              <Button className="min-h-11" onClick={() => setScreen({ kind: "pin", person: last })}>
                Seguir como {last.name}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** `compact`: next to the order screen, only the logo until there is room (lg). */
function Brand({ subtitle, compact }: { subtitle: string; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3" title={compact ? subtitle : undefined}>
      <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-primary font-bold text-primary-foreground">
        V
      </span>
      <span className={cn("min-w-0", compact && "hidden lg:block")}>
        <b className="block text-sm">Terminal de pedidos</b>
        <small className="block truncate text-xs text-muted-foreground">{subtitle}</small>
      </span>
    </span>
  )
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid flex-none place-items-center rounded-full bg-primary/10 font-semibold text-primary", className)}
    >
      {initialsOf(name)}
    </span>
  )
}

interface PinScreenProps {
  person: Person
  title: string
  hint: string
  lockedUntil?: string
  onLocked: (until?: string) => void
  onBack: () => void
  backLabel: string
  onSuccess: (answer: { token: string; expiresAt: string }) => Promise<void>
}

/** Name, message and a large PIN pad (keys of 64 px); the PIN is checked by POST /auth/identify. */
function PinScreen({ person, title, hint, lockedUntil, onLocked, onBack, backLabel, onSuccess }: PinScreenProps) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = lockedUntil !== undefined
  const disabled = locked || busy

  const press = useCallback(
    (digit: string) => {
      setError(null)
      setPin((current) => (current.length < PIN_MAX_LENGTH ? current + digit : current))
    },
    [],
  )
  const erase = useCallback(() => setPin((current) => current.slice(0, -1)), [])

  const submit = useCallback(async () => {
    if (pin.length < 4 || disabled) return
    setBusy(true)
    try {
      const answer = await identifyStaff(person.id, pin)
      await onSuccess(answer)
    } catch (err) {
      const failure = pinFailureOf(err)
      setPin("")
      if (failure.kind === "locked") {
        onLocked(failure.lockedUntil)
        setError(failure.lockedUntil ? null : failure.message)
      } else if (failure.kind === "wrong") {
        setError(`${failure.message}. 5 intentos fallidos lo bloquean 5 minutos.`)
      } else {
        setError(failure.message)
      }
    } finally {
      setBusy(false)
    }
  }, [pin, disabled, person.id, onSuccess, onLocked])

  // A tablet with a keyboard, or a desktop: digits, Backspace and Enter work too.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled) return
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === "Backspace") erase()
      else if (event.key === "Enter") void submit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [disabled, press, erase, submit])

  const slots = Math.max(4, pin.length)
  const key =
    "grid min-h-16 place-items-center rounded-card border bg-card text-2xl font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <section
      aria-labelledby="terminal-pin-h"
      className="grid w-full max-w-[440px] items-center gap-6 md:max-w-4xl md:grid-cols-[minmax(0,1fr)_360px] md:gap-8"
    >
      <div className="flex flex-col items-center gap-3 text-center md:items-start md:text-left">
        <Avatar name={person.name} className="h-16 w-16 text-2xl" />
        <h1 id="terminal-pin-h" className="text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {locked ? (
          <p role="alert" className="rounded-xl border border-status-danger-line bg-status-danger-bg px-3.5 py-3 text-sm text-status-danger-fg">
            <b>Bloqueado hasta {clockTime(lockedUntil)}.</b> Hubo 5 intentos fallidos. Espera o pide al admin que lo desbloquee.
          </p>
        ) : error ? (
          <p role="alert" className="rounded-xl border border-status-danger-line bg-status-danger-bg px-3.5 py-3 text-sm text-status-danger-fg">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground">{hint}</p>
        )}
        <Button variant="outline" className="min-h-11" onClick={onBack}>
          {backLabel}
        </Button>
      </div>
      <div>
        <div aria-label={`${pin.length} dígitos escritos`} className="mb-5 flex min-h-5 justify-center gap-3.5">
          {Array.from({ length: slots }, (_, i) => (
            <i
              key={i}
              className={cn(
                "h-[18px] w-[18px] rounded-full border-2",
                i < pin.length ? "border-foreground bg-foreground" : error || locked ? "border-status-danger-fg" : "border-muted-foreground/40",
              )}
            />
          ))}
        </div>
        <div role="group" aria-label="Teclado del PIN" className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} type="button" className={key} disabled={disabled} onClick={() => press(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" className={cn(key, "text-base font-medium")} disabled={disabled} aria-label="Borrar dígito" onClick={erase}>
            <Delete className="h-6 w-6" aria-hidden />
          </button>
          <button type="button" className={key} disabled={disabled} onClick={() => press("0")}>
            0
          </button>
          <button
            type="button"
            className={cn(key, "bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90")}
            disabled={disabled}
            onClick={() => void submit()}
          >
            Entrar
          </button>
        </div>
      </div>
    </section>
  )
}
