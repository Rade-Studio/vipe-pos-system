"use client"

import { useState, useEffect } from "react"
import { ProfileSelection } from "@/components/profiles/ProfileSelection"
import { WaiterView } from "@/components/views/WaiterView"
import { KitchenView } from "@/components/views/KitchenView"
import { CashierView } from "@/components/views/CashierView"
import { AdminView } from "@/components/views/AdminView"
import { LoginView } from "@/components/auth/LoginView"
import { Loader2 } from "lucide-react"
import { useConfigStore } from "@/store/use-config-store"
import { useCashRegisterStore } from "@/store/use-cash-register-store"
import { useTableStore } from "@/store/useTableStore"
import { useProfileStore } from "@/store/useProfileStore"
import { useOrderStore } from "@/store/useOrderStore"
import { tableService, orderService } from "@/lib/supabase/service"
import { supabase } from "@/lib/supabase/client"
import type { Profile, ProfileRole } from "@/types"

export default function Home() {
  const selectedProfile = useProfileStore((s) => s.selectedProfile)
  const setSelectedProfile = useProfileStore((s) => s.setSelectedProfile)
  const setAuthProfile = useProfileStore((s) => s.setAuthProfile)
  const authProfile = useProfileStore((s) => s.authProfile)
  const profiles = useProfileStore((s) => s.profiles)
  const setProfiles = useProfileStore((s) => s.setProfiles)
  const showProfileSelection = useProfileStore((s) => s.showProfileSelection)
  const selectProfile = useProfileStore((s) => s.selectProfile)
  const changeProfile = useProfileStore((s) => s.changeProfile)
  const { setTables } = useTableStore()
  const { loadCurrentRegister, loadAllRegisters } = useCashRegisterStore()
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const { loadConfigFromDB } = useConfigStore()

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
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      setIsAuthenticated(!!data.session)
      if (data.session) {
        await loadProfileFromAuth()
      }

      // Suscribirse a cambios en la autenticación
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        setIsAuthenticated(!!session)
        if (session) {
          loadProfileFromAuth()
        }
      })

      return () => {
        authListener.subscription.unsubscribe()
      }
    }

    checkAuth()
  }, [])

  // Cargar la configuración al iniciar la aplicación
  useEffect(() => {
    const initApp = async () => {
      try {
        // Solo cargar datos si el usuario está autenticado
        if (!isAuthenticated) {
          setIsLoading(false)
          return
        }

        // Cargar la configuración desde la base de datos
        await loadConfigFromDB()

        // Cargar mesas
        const tablesData = await tableService.getAll()
        const formattedTables = tablesData.map((table) => ({
          id: table.id,
          number: table.number,
          status: table.status as "available" | "reserved" | "occupied" | "kitchen" | "served",
          waiter: table.waiter_id ?? undefined,
          restaurantId: table.restaurant_id,
        }))
        setTables(formattedTables)

        // Cargar meseros y mapearlos al formato Profile del store
        const waitersData = await tableService.getWaiters()
        const waiterProfiles: Profile[] = waitersData.map((w) => ({
          id: w.id,
          name: w.name,
          username: w.username ?? null,
          role: w.role as ProfileRole,
          hasPassword: false,
        }))
        setProfiles(waiterProfiles)

        // Cargar órdenes activas
        await loadActiveOrders()

        // Cargar información de caja actual
        await loadCurrentRegister()

        await loadAllRegisters()

      } catch (error) {
      } finally {
        // Finalizar la carga después de un breve retraso para mostrar la pantalla de carga
        setTimeout(() => {
          setIsLoading(false)
        }, 500)
      }
    }

    async function loadActiveOrders() {
      try {
        // Cargar órdenes en cocina y entregadas
        const kitchenOrders = await orderService.getByStatus("kitchen")
        const deliveredOrders = await orderService.getByStatus("delivered")

        // Combinar las órdenes
        const dbOrders = [...kitchenOrders, ...deliveredOrders]

        // Convertir las órdenes de la base de datos al formato que espera el store
        const storeOrders = dbOrders.map((dbOrder) => {
          // Convertir los items de la orden
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

          // Crear el objeto de orden para el store
          return {
            id: dbOrder.id,
            tableId: dbOrder.table_id ?? "",
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

        // Actualizar el store con las órdenes
        useOrderStore.getState().setOrders(storeOrders as any)
      } catch (error) {
        console.error("Error al cargar órdenes activas:", error)
      }
    }

    if (isAuthenticated) {
      initApp()
    } else {
      setIsLoading(false)
    }
  }, [loadConfigFromDB, setTables, loadCurrentRegister, loadAllRegisters, isAuthenticated])

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
    return <ProfileSelection profiles={profiles} onSelectProfile={selectProfile} />
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
  if (selectedProfile.role === "waiter") {
    return <WaiterView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
  }

  if (selectedProfile.role === "kitchen") {
    return <KitchenView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
  }

  if (selectedProfile.role === "cashier") {
    return <CashierView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
  }

  if (selectedProfile.role === "admin") {
    return <AdminView profile={selectedProfile} onChangeProfile={changeProfile} authRole={authProfile?.role} />
  }

  // Fallback (should never happen)
  return <div>Error: Perfil no válido</div>
}
