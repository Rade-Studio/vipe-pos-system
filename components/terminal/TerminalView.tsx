"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Alert, StepSheet } from "@/components/voids/sheet"
import type { Supervisor } from "@/components/voids/flow"
import { identifyByPin, pinFailureOf, profileFromSession, signOutAndReload, unlockTerminal, type Session } from "@/lib/api/auth"
import { clearActingToken, setActingToken } from "@/lib/terminal/acting"
import { clockTime } from "@/lib/terminal/format"
import { useCartStore } from "@/store/useCartStore"
import { useProfileStore } from "@/store/useProfileStore"
import type { ProfileRole } from "@/types"
import { PinStep, SupervisorStep, WarningStep } from "./TerminalSheet"
import { TerminalContext, type IdentityRequest, type TerminalApi, type TerminalIdentity } from "./terminal-context"

/** Same length as ACTING_TTL_MS in the API: the claim never outlives it here. */
const ACTING_TTL_MS = 5 * 60_000
const WRONG_PIN = "PIN no válido"

interface Person {
  id: string
  name: string
}

type Sheet =
  | { kind: "identify"; request: IdentityRequest }
  | { kind: "unlockWho"; request: IdentityRequest }
  | { kind: "unlockPin"; request: IdentityRequest; supervisor: Supervisor }
  | { kind: "warning"; request: IdentityRequest; owner: Person; count: number }
  | { kind: "logoutWho" }
  | { kind: "logoutPin"; supervisor: Supervisor }

interface TerminalViewProps {
  /** The terminal session (POST /auth/terminal/login) of the admin or cashier who opened it. */
  session: Session
  /** The normal waiter screen (WaiterView): same header, floor map and order steps. */
  children: ReactNode
}

const unsentCount = (tableId: string) =>
  (useCartStore.getState().cartItems[tableId] ?? []).reduce((total, item) => total + item.quantity, 0)

/**
 * Shared order-taking terminal (F4b, L20-L22): the normal waiter app, plus a
 * PIN sheet when an order-writing entry has no valid identity. A valid PIN
 * (POST /auth/identify with the PIN alone) says who it is: for 5 minutes the
 * store's profile is theirs and the API client adds their acting claim to
 * every write. Expiry keeps the unsent cart; a different person on a table
 * with someone else's unsent products chooses Continuar or Descartar. 5 wrong
 * PINs lock the tablet until a supervisor PIN unlocks it; "Salir" needs the
 * PIN of an admin or cashier (GET /staff/supervisors, never the waiters).
 */
export function TerminalView({ session, children }: TerminalViewProps) {
  const [identity, setIdentity] = useState<TerminalIdentity | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [tabletLock, setTabletLock] = useState<string | null>(null)
  const [supervisorLocks, setSupervisorLocks] = useState<Record<string, string>>({})
  const identityRef = useRef<TerminalIdentity | null>(null)
  identityRef.current = identity
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  /** Who added the unsent products of each table. */
  const owners = useRef<Record<string, Person>>({})
  /** Who held the tablet last: owns products added after their identity ended (F-c). */
  const lastPerson = useRef<Person | null>(null)
  /** No identity: the screen acts as the admin or cashier who opened the terminal (F-d). */
  const sessionRef = useRef(session)
  sessionRef.current = session
  const releaseIdentity = useCallback(() => {
    clearActingToken()
    setIdentity(null)
    const opener = profileFromSession(sessionRef.current)
    useProfileStore.setState({ authProfile: opener, selectedProfile: opener })
  }, [])

  useEffect(() => () => clearActingToken(), [])

  useEffect(
    () =>
      useCartStore.subscribe((state) => {
        for (const [tableId, items] of Object.entries(state.cartItems)) {
          const who = identityRef.current ?? lastPerson.current
          if (items.length === 0) delete owners.current[tableId]
          else if (!owners.current[tableId] && who) owners.current[tableId] = { id: who.id, name: who.name }
        }
      }),
    [],
  )

  useEffect(() => {
    if (!identity && !tabletLock) return
    const id = setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (identityRef.current && at >= identityRef.current.deadline) {
        identityRef.current = null
        releaseIdentity()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [identity, tabletLock, releaseIdentity])

  const finish = useCallback((ok: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setSheet(null)
    setProblem(null)
    resolve?.(ok)
  }, [])

  /** After a valid identity: a table with someone else's unsent products asks first. */
  const checkTable = useCallback(
    (person: Person, request: IdentityRequest) => {
      const owner = request.tableId ? owners.current[request.tableId] : undefined
      const count = request.tableId ? unsentCount(request.tableId) : 0
      if (owner && owner.id !== person.id && count > 0) {
        setProblem(null)
        setSheet({ kind: "warning", request, owner, count })
      } else finish(true)
    },
    [finish],
  )

  const ensureIdentity = useCallback(
    (request: IdentityRequest) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        const current = identityRef.current
        if (current && current.deadline > Date.now()) checkTable(current, request)
        else {
          setProblem(null)
          setSheet({ kind: "identify", request })
        }
      }),
    [checkTable],
  )

  const endIdentity = useCallback(() => {
    identityRef.current = null
    releaseIdentity()
  }, [releaseIdentity])

  const requestLogout = useCallback(() => {
    resolver.current?.(false)
    resolver.current = null
    setProblem(null)
    setSheet({ kind: "logoutWho" })
  }, [])

  const identify = async (pin: string, request: IdentityRequest) => {
    try {
      const answer = await identifyByPin(pin)
      const at = Date.now()
      const person = { id: answer.profile.id, name: answer.profile.name }
      lastPerson.current = person
      setActingToken(answer.token)
      setIdentity({ ...person, role: answer.profile.role, deadline: Math.min(Date.parse(answer.expiresAt), at + ACTING_TTL_MS) })
      setNow(at)
      const profile = { id: person.id, name: person.name, full_name: person.name, role: answer.profile.role as ProfileRole }
      useProfileStore.setState({ authProfile: profile, selectedProfile: profile })
      checkTable(person, request)
    } catch (err) {
      const failure = pinFailureOf(err)
      if (failure.kind === "locked" && failure.lockedUntil) {
        setTabletLock(failure.lockedUntil)
        setProblem(null)
      } else setProblem(failure.kind === "wrong" ? WRONG_PIN : failure.message)
    }
  }

  const supervisorPin = async (supervisor: Supervisor, pin: string, check: () => Promise<unknown>, done: () => void) => {
    try {
      await check()
      done()
    } catch (err) {
      const failure = pinFailureOf(err)
      if (failure.kind === "locked" && failure.lockedUntil) {
        setSupervisorLocks((current) => ({ ...current, [supervisor.id]: failure.lockedUntil! }))
        setProblem(`Bloqueado hasta ${clockTime(failure.lockedUntil)}. Pide a otra persona o espera.`)
      } else setProblem(failure.kind === "wrong" ? WRONG_PIN : failure.message)
    }
  }

  const api: TerminalApi = useMemo(
    () => ({ identity, now, ensureIdentity, endIdentity, requestLogout }),
    [identity, now, ensureIdentity, endIdentity, requestLogout],
  )

  const lockedUntil = tabletLock && Date.parse(tabletLock) > now ? tabletLock : null
  const alert = problem && <Alert tone="danger">{problem}</Alert>
  const back = (next: Sheet) => () => {
    setProblem(null)
    setSheet(next)
  }

  let body: ReactNode = null
  if (sheet?.kind === "identify") {
    body = lockedUntil ? (
      <PinStep
        eyebrow={sheet.request.label}
        title={`Tablet bloqueada hasta ${clockTime(lockedUntil)}`}
        alert={<Alert tone="danger">Hubo 5 PIN no válidos seguidos. Espera o pide a un supervisor que la desbloquee.</Alert>}
        locked
        submitLabel="Entrar"
        onSubmit={async () => {}}
        below={
          <Button className="h-12 w-full text-base" onClick={back({ kind: "unlockWho", request: sheet.request })}>
            Desbloquear con PIN de supervisor
          </Button>
        }
      />
    ) : (
      <PinStep
        eyebrow="Terminal compartida"
        title={`${sheet.request.label} · Escribe tu PIN`}
        alert={alert || <p className="text-sm text-muted-fg">Tu PIN dice quién toma el pedido. Quedas identificado 5 minutos.</p>}
        submitLabel="Entrar"
        onSubmit={(pin) => identify(pin, sheet.request)}
      />
    )
  } else if (sheet?.kind === "unlockWho" || sheet?.kind === "logoutWho") {
    const unlocking = sheet.kind === "unlockWho"
    body = (
      <SupervisorStep
        eyebrow={unlocking ? "Desbloquear tablet" : "Salir de la terminal"}
        title="¿Quién confirma?"
        note={unlocking ? "Solo un admin o cajero con PIN la desbloquea." : "Solo un admin o cajero con PIN cierra la terminal. Los pedidos sin enviar se pierden."}
        locks={supervisorLocks}
        onPick={(supervisor) =>
          unlocking
            ? back({ kind: "unlockPin", request: sheet.request, supervisor })()
            : back({ kind: "logoutPin", supervisor })()
        }
        onBack={unlocking ? back({ kind: "identify", request: sheet.request }) : undefined}
      />
    )
  } else if (sheet?.kind === "unlockPin" || sheet?.kind === "logoutPin") {
    const { supervisor } = sheet
    const unlocking = sheet.kind === "unlockPin"
    const locked = supervisorLocks[supervisor.id] && Date.parse(supervisorLocks[supervisor.id]) > now
    body = (
      <PinStep
        key={supervisor.id}
        eyebrow={unlocking ? "Desbloquear tablet" : "Salir de la terminal"}
        title={`${supervisor.fullName.split(/\s+/)[0]}, escribe tu PIN`}
        person={{ name: supervisor.fullName, role: supervisor.role }}
        alert={alert}
        locked={Boolean(locked)}
        submitLabel={unlocking ? "Desbloquear" : "Salir"}
        onSubmit={(pin) =>
          sheet.kind === "unlockPin"
            ? supervisorPin(supervisor, pin, () => unlockTerminal(supervisor.id, pin), () => {
                setTabletLock(null)
                back({ kind: "identify", request: sheet.request })()
              })
            : // F-a: only the supervisor's own counter (POST /auth/terminal/unlock), never the tablet lock.
            supervisorPin(supervisor, pin, () => unlockTerminal(supervisor.id, pin), () => {
                clearActingToken()
                void signOutAndReload()
              })
        }
        footer={
          <Button
            variant="outline"
            className="h-12 flex-1 text-base"
            onClick={back(sheet.kind === "unlockPin" ? { kind: "unlockWho", request: sheet.request } : { kind: "logoutWho" })}
          >
            Atrás
          </Button>
        }
      />
    )
  } else if (sheet?.kind === "warning") {
    const { request, owner, count } = sheet
    body = (
      <WarningStep
        label={request.label}
        owner={owner.name.split(/\s+/)[0]}
        count={count}
        onContinue={() => {
          const who = identityRef.current ?? lastPerson.current
          if (request.tableId && who) owners.current[request.tableId] = { id: who.id, name: who.name }
          finish(true)
        }}
        onDiscard={() => {
          if (request.tableId) useCartStore.getState().clearCart(request.tableId)
          finish(true)
        }}
      />
    )
  }

  return (
    <TerminalContext.Provider value={api}>
      {children}
      <StepSheet open={sheet !== null} onClose={() => finish(false)}>
        {body}
      </StepSheet>
    </TerminalContext.Provider>
  )
}
