"use client"

import { useState, useEffect, useRef } from "react"
import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { WaiterView } from "@/components/views/WaiterView"
import { KitchenView } from "@/components/views/KitchenView"
import { CashierView } from "@/components/views/CashierView"
import { AdminView } from "@/components/views/AdminView"
import { DeliveryView } from "@/components/views/DeliveryView"
import { LoginView } from "@/components/auth/LoginView"
import { Loader2 } from "lucide-react"
import { useConfigStore } from "@/store/use-config-store"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useOrderStore } from "@/store/useOrderStore"
import { tableService, orderService } from "@/lib/supabase/service"
import { supabase } from "@/lib/supabase/client"
import { viewForRole } from "@/lib/auth/roles"
import { startupLoadsForRole, startupRole, type ShellLoad } from "@/lib/shell/startup-loads"
import { shouldReloadAuthProfile } from "@/lib/shell/auth-events"
import { log } from "@/lib/log"
import type { Profile, ProfileRole } from "@/types"
import { orderTypeFromRow } from "@/lib/delivery/kitchen"

/**
 * One call for both statuses: the shell used to issue `getByStatus("kitchen")`
 * and `getByStatus("delivered")` back to back and concatenated them.
 */
async function loadKitchenAndDeliveredOrders() {
  const dbOrders = await orderService.getByStatus(["kitchen", "delivered"])

  // Convertir las órdenes de la base de datos al formato que espera el store
  const storeOrders = dbOrders.map((dbOrder) => {
    const items = dbOrder.order_items.map((item) => ({
      id: item.dish_id || `item-${item.id}`,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      comments: item.comments ?? undefined,
      categoryId: "",
      image: "",
      status: (item.status ?? "kitchen") as "kitchen" | "served",
      addedAt: item.added_at ? new Date(item.added_at) : undefined,
    }))

    return {
      id: dbOrder.id,
      tableId: dbOrder.table_id ?? "",
      orderType: orderTypeFromRow(dbOrder),
      items,
      status: dbOrder.status as "active" | "kitchen" | "delivered" | "paid" | "cancelled",
      bill: {
        subtotal: dbOrder.subtotal,
        tax: dbOrder.tax,
        taxPercentage: dbOrder.tax_percentage,
        tip: dbOrder.tip,
        tipPercentage: dbOrder.tip_percentage,
        total: dbOrder.total,
        totalDiscounts: dbOrder.total_discounts ?? 0,
      },
      waiter: dbOrder.waiter_id ?? "",
      createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
      isPartialOrder: dbOrder.is_partial_order ?? false,
      parentOrderId: dbOrder.parent_order_id ?? null,
    }
  })

  useOrderStore.getState().setOrders(storeOrders as any)
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
  // `profileResolved` separates "we have not asked yet" from "there is no
  // profile row", so the startup loads never run twice for one identity.
  const [profileResolved, setProfileResolved] = useState(false)
  const loadConfigFromDB = useConfigStore((s) => s.loadConfigFromDB)
  const startupKeyRef = useRef<string | null>(null)

  // Cargar el profile del usuario autenticado desde la DB
  const loadProfileFromAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data: me } = await supabase
      .from("profiles")
      .select("id, full_name, username, role, restaurant_id, active")
      .eq("auth_user_id", user.id)
      .eq("active", true)
      .maybeSingle()
    if (!me) return null
    const profile: Profile = {
      id: me.id,
      name: me.full_name || me.username || me.role,
      full_name: me.full_name,
      username: me.username,
      role: me.role as ProfileRole,
      hasPassword: true,
      restaurantId: me.restaurant_id,
    }
    setAuthProfile(profile)     // identidad real (UUID válido)
    setSelectedProfile(profile) // vista inicial = tu rol real
    return profile
  }

  // Verificar estado de autenticación al cargar la página
  useEffect(() => {
    let cancelled = false
    let lastUserId: string | null = null

    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      lastUserId = data.session?.user?.id ?? null
      // Resolve the identity BEFORE flipping `isAuthenticated`, so the startup
      // effect below runs once with the real role already in the store.
      if (data.session) {
        await loadProfileFromAuth()
      }
      if (cancelled) return
      setProfileResolved(true)
      setIsAuthenticated(!!data.session)

      // Suscribirse a cambios en la autenticación. The cleanup used to be
      // returned from inside this async function, so React never saw it and the
      // listener leaked for the life of the page.
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        const userId = session?.user?.id ?? null
        setIsAuthenticated(!!session)
        if (!shouldReloadAuthProfile(event, lastUserId, userId)) {
          // TOKEN_REFRESHED / INITIAL_SESSION duplicate: re-reading the profile
          // here used to reset an admin's impersonated view.
          lastUserId = userId
          return
        }
        lastUserId = userId
        void loadProfileFromAuth()
      })

      return () => {
        authListener.subscription.unsubscribe()
      }
    }

    // Keep the returned cleanup outside the async function so it always runs.
    let dispose: (() => void) | undefined
    checkAuth().then((cleanup) => {
      dispose = cleanup
    })

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // Cargar la configuración al iniciar la aplicación
  useEffect(() => {
    if (!isAuthenticated) {
      setIsLoading(false)
      // Signing out arms the next sign-in, even for the same role.
      startupKeyRef.current = null
      return
    }
    // Keep the full-screen loader until the identity is known: running the loads
    // now and again one tick later (when `authProfile` lands) doubled them.
    if (!profileResolved) return

    const role = startupRole({
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
          const tablesData = await tableService.getAll()
          setTables(
            tablesData.map((table) => ({
              id: table.id,
              number: table.number,
              status: table.status as "available" | "reserved" | "occupied" | "kitchen" | "served",
              waiter: table.waiter_id ?? undefined,
              restaurantId: table.restaurant_id,
            })),
          )
          return
        }

        case "waiters": {
          const waitersData = await tableService.getWaiters()
          setProfiles(
            waitersData.map((w) => ({
              id: w.id,
              name: w.name,
              username: w.username ?? null,
              role: w.role as ProfileRole,
              hasPassword: false,
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
    profileResolved,
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
    return <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />
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
