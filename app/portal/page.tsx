"use client"

import { useState, useEffect, useRef } from "react"
import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { WaiterView } from "@/components/views/WaiterView"
import { KitchenView } from "@/components/views/KitchenView"
import { CashierView } from "@/components/views/CashierView"
import { AdminView } from "@/components/views/AdminView"
import { DeliveryView } from "@/components/views/DeliveryView"
import { TerminalView } from "@/components/terminal/TerminalView"
import { LoginView } from "@/components/auth/LoginView"
import { Loader2 } from "lucide-react"
import { useConfigStore } from "@/store/use-config-store"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useOrderStore } from "@/store/useOrderStore"
import * as tablesApi from "@/lib/api/tables"
import { getByStatus, toOrder } from "@/lib/api/orders"
import { fetchSession, profileFromSession, type Session } from "@/lib/api/auth"
import { viewForRole } from "@/lib/auth/roles"
import { startupLoadsForRole, startupRole, type ShellLoad } from "@/lib/shell/startup-loads"
import { onAuthEvent } from "@/lib/shell/auth-events"
import { log } from "@/lib/log"
import type { ProfileRole } from "@/types"

/**
 * One call for both statuses: the shell used to issue `getByStatus("kitchen")`
 * and `getByStatus("delivered")` back to back and concatenated them. Mapped by
 * the shared `toOrder` (T8b).
 */
async function loadKitchenAndDeliveredOrders() {
  const orders = await getByStatus(["kitchen", "delivered"])
  useOrderStore.getState().setOrders(orders.map(toOrder))
}

/**
 * The loader stays up until the first session check settles; past this limit a
 * hung `/auth/me` counts as a failed check and the login form appears.
 */
const INITIAL_CHECK_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`session check timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export default function Home() {
  const selectedProfile = useProfileStore((s) => s.selectedProfile)
  const setSelectedProfile = useProfileStore((s) => s.setSelectedProfile)
  const setAuthProfile = useProfileStore((s) => s.setAuthProfile)
  const authProfile = useProfileStore((s) => s.authProfile)
  // The REAL role (never the impersonated one) decides the startup loads.
  const authRole = useProfileStore((s) => s.authProfile?.role)
  const roleProfiles = useProfileStore((s) => s.roleProfiles)
  const setProfiles = useProfileStore((s) => s.setProfiles)
  const showProfileSelection = useProfileStore((s) => s.showProfileSelection)
  const selectProfile = useProfileStore((s) => s.selectProfile)
  const changeProfile = useProfileStore((s) => s.changeProfile)
  // D6, newly enumerated site: this selectorless destructure subscribed the
  // root page component to every store write, including every unrelated table
  // patch — the widest-blast-radius subscription in the codebase.
  const setTables = useTableStore((s) => s.setTables)
  // Selector reads only: the two destructures that used to sit here subscribed
  // the WHOLE app to every cash-register and config write, which is what made a
  // register load blink the screen.
  const loadAllRegisters = useCashRegisterStore((s) => s.loadAllRegisters)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // F4: a shared order-taking terminal (POST /auth/terminal/login) shows the
  // terminal flow instead of the opener's role view.
  const [terminalSession, setTerminalSession] = useState<Session | null>(null)
  // `profileResolved` separates "we have not asked yet" from "there is no
  // profile row", so the startup loads never run twice for one identity.
  const [profileResolved, setProfileResolved] = useState(false)
  // The first check is a network round trip (`/auth/me`, maybe a refresh):
  // keep the loader up until it settles so a signed-in user never sees the
  // form flash, and no login can start while it is pending.
  const [initialCheckDone, setInitialCheckDone] = useState(false)
  const loadConfigFromDB = useConfigStore((s) => s.loadConfigFromDB)
  const startupKeyRef = useRef<string | null>(null)
  // Bumped by every login. The initial session check remembers the value it
  // started with, so its late null, error or `signed_out` (D3 smoke) never
  // wipes a session the user created while it was still pending.
  const loginSeqRef = useRef(0)

  // Role and restaurant come from the API session (`me` or the login body).
  const applySession = (session: Session) => {
    const profile = profileFromSession(session)
    setTerminalSession(session.sessionKind === "terminal" ? session : null)
    setAuthProfile(profile)     // identidad real (UUID válido)
    setSelectedProfile(profile) // vista inicial = tu rol real
    setProfileResolved(true)
    setIsAuthenticated(true)
  }

  const clearSession = () => {
    setTerminalSession(null)
    setAuthProfile(null)
    setSelectedProfile(null)
    setProfileResolved(true)
    setIsAuthenticated(false)
  }

  // Resolve the session once with `GET /api/auth/me`. Token refreshes happen
  // inside the API client and never reach the shell, so an admin's
  // impersonated view survives them; only a failed refresh signs out.
  useEffect(() => {
    let cancelled = false
    let checkPending = true
    const startSeq = loginSeqRef.current
    const isStale = () => cancelled || loginSeqRef.current !== startSeq
    const stop = onAuthEvent((event) => {
      if (event !== "signed_out" || cancelled) return
      // While the initial check is in flight, its refused refresh belongs to
      // the pre-login cookies; once it settles, every refusal is genuine.
      if (checkPending && isStale()) return
      clearSession()
    })

    // The chain stays "pending" until the real request settles, not the timeout:
    // a hung check's refused refresh, arriving after a login made once the form
    // appeared, still belongs to the pre-login cookies.
    const check = fetchSession()
    check.then(
      () => {
        checkPending = false
      },
      () => {
        checkPending = false
      },
    )

    withTimeout(check, INITIAL_CHECK_TIMEOUT_MS)
      .finally(() => {
        if (!cancelled) setInitialCheckDone(true)
      })
      .then((session) => {
        if (isStale()) return
        // Resolve the identity BEFORE flipping `isAuthenticated`, so the startup
        // effect below runs once with the real role already in the store.
        if (session) {
          applySession(session)
          // As on dev, the role view shows while the startup loads run.
          setIsLoading(false)
        } else clearSession()
      })
      .catch((error: unknown) => {
        log.error("Error al resolver la sesión:", { error: String(error) })
        if (!isStale()) clearSession()
      })

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  // Cargar la configuración al iniciar la aplicación
  useEffect(() => {
    if (!isAuthenticated) {
      if (!initialCheckDone) return
      setIsLoading(false)
      // Signing out arms the next sign-in, even for the same role.
      startupKeyRef.current = null
      return
    }
    // Keep the full-screen loader until the identity is known: running the loads
    // now and again one tick later (when `authProfile` lands) doubled them.
    if (!profileResolved) return
    const isTerminal = terminalSession !== null

    // A terminal reaches only the order-taking routes: it loads what a waiter
    // loads, whoever opened it or is identified on it.
    const role = isTerminal ? "waiter" : startupRole({
      authRole,
      // Read without subscribing: impersonating a role must not re-run this.
      selectedRole: useProfileStore.getState().selectedProfile?.role,
    })
    const loads = startupLoadsForRole(role)
    const key = `${isAuthenticated}|${role ?? "unknown"}`
    if (startupKeyRef.current === key) return
    startupKeyRef.current = key

    let cancelled = false

    const runLoads = async () => {
      // Parallel, and one failure never blocks the rest. No fixed delay behind
      // the loader any more.
      const results = await Promise.allSettled(
        loads.map((load) => runStartupLoad(load, role)),
      )

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          log.error(`Error al cargar "${loads[index]}" al iniciar:`, { error: String(result.reason) })
        }
      })

      if (!cancelled) setIsLoading(false)
    }

    const runStartupLoad = async (load: ShellLoad, startupRoleValue: string | null) => {
      switch (load) {
        // Only an admin may seed the missing `business_config` keys (RLS).
        case "config":
          return loadConfigFromDB({ canWrite: startupRoleValue === "admin" })

        case "tables": {
          const tablesData = await tablesApi.getAll()
          setTables(tablesData.map(tablesApi.toTable))
          return
        }

        case "waiters": {
          const waitersData = await tablesApi.getWaiters()
          setProfiles(
            waitersData.map((w) => ({
              id: w.id,
              name: w.name,
              username: w.username ?? null,
              role: "waiter" as ProfileRole,
            })),
          )
          return
        }

        case "kitchenOrders":
          return loadKitchenAndDeliveredOrders()

        case "allRegisters":
          return loadAllRegisters()
      }
    }

    void runLoads()

    return () => {
      cancelled = true
    }
  }, [
    isAuthenticated,
    initialCheckDone,
    profileResolved,
    terminalSession,
    authRole,
    loadConfigFromDB,
    loadAllRegisters,
    setTables,
    setProfiles,
  ])

  // Pantalla de carga mientras se inicializa la aplicación
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Cargando Sistema POS</h1>
          <p className="text-muted-foreground">Inicializando configuración...</p>
        </div>
      </div>
    )
  }

  // Pantalla de login si no está autenticado
  if (!isAuthenticated) {
    return (
      <LoginView
        onLoginSuccess={(session) => {
          loginSeqRef.current += 1
          applySession(session)
        }}
      />
    )
  }

  if (terminalSession) {
    return (
      <TerminalView session={terminalSession}>
        {(bar) =>
          selectedProfile && <WaiterView profile={selectedProfile} onChangeProfile={() => {}} header={bar} />
        }
      </TerminalView>
    )
  }

  // Profile selection screen (admin usa esto para cambiar de rol).
  // Debe ir ANTES del check de selectedProfile porque changeProfile() deja
  // selectedProfile en null mientras el picker está abierto.
  if (showProfileSelection) {
    return <ProfileSelection profiles={roleProfiles} onSelectProfile={selectProfile} />
  }

  // Cargando perfil del usuario autenticado
  if (!selectedProfile) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Cargando perfil</h1>
          <p className="text-muted-foreground">Identificando usuario…</p>
        </div>
      </div>
    )
  }

  // Render the appropriate view based on the selected profile role
  switch (viewForRole(selectedProfile.role)) {
    case "waiter":
      return <WaiterView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
    case "kitchen":
      return <KitchenView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
    case "cashier":
      return <CashierView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
    case "admin":
      return <AdminView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
    case "delivery":
      return <DeliveryView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
    default:
      return <div>Error: Perfil no válido</div>
  }
}
